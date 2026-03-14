/**
 * Backup Service (v1.4)
 *
 * Full and incremental backup of DB + config + audio files.
 * Uses archiver for streaming ZIP creation to handle potentially large audio files.
 */

const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { app } = require('electron');
const log = require('electron-log');
const databaseService = require('./databaseService');
const backgroundTaskManager = require('./backgroundTaskManager');

class BackupService {
  constructor() {
    this.configDir = null;
    this.vaultPath = null;
  }

  /**
   * Initialize paths (call after app.whenReady).
   * @param {string} [vaultPath] - Obsidian vault path
   */
  initialize(vaultPath) {
    this.configDir = path.join(app.getPath('userData'), 'config');
    this.vaultPath = vaultPath || null;
  }

  /**
   * Get a manifest of what would be backed up, with size estimates.
   * @returns {{ database: Object, config: Object, audio: Object, total: Object }}
   */
  getBackupManifest() {
    const manifest = {
      database: { files: 0, size: 0, path: null },
      config: { files: 0, size: 0, items: [] },
      audio: { files: 0, size: 0, items: [] },
      total: { files: 0, size: 0 },
      lastBackup: databaseService.getLastBackup(),
    };

    // Database
    const dbPath = databaseService.dbPath;
    if (dbPath && fs.existsSync(dbPath)) {
      const stat = fs.statSync(dbPath);
      manifest.database = { files: 1, size: stat.size, path: dbPath };
      manifest.total.files++;
      manifest.total.size += stat.size;
    }

    // Config files
    if (this.configDir && fs.existsSync(this.configDir)) {
      const configFiles = this._walkDir(this.configDir);
      manifest.config.files = configFiles.length;
      manifest.config.items = configFiles.map(f => ({
        name: path.relative(this.configDir, f),
        size: fs.statSync(f).size,
      }));
      manifest.config.size = manifest.config.items.reduce((sum, f) => sum + f.size, 0);
      manifest.total.files += manifest.config.files;
      manifest.total.size += manifest.config.size;
    }

    // Audio files from database
    const audioFiles = this._getAudioFilePaths();
    manifest.audio.files = audioFiles.length;
    manifest.audio.items = audioFiles.map(f => ({
      name: path.basename(f),
      size: fs.existsSync(f) ? fs.statSync(f).size : 0,
    }));
    manifest.audio.size = manifest.audio.items.reduce((sum, f) => sum + f.size, 0);
    manifest.total.files += manifest.audio.files;
    manifest.total.size += manifest.audio.size;

    return manifest;
  }

  /**
   * Create a full backup as a ZIP file.
   * @param {string} outputDir - Directory to write the backup ZIP to
   * @returns {Promise<{ success: boolean, path: string, filesIncluded: number, totalSize: number }>}
   */
  async createFullBackup(outputDir) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipName = `jd-notes-backup-${timestamp}.zip`;
    const zipPath = path.join(outputDir, zipName);

    const taskId = backgroundTaskManager.addTask({
      type: 'backup',
      description: 'Creating full backup...',
      metadata: { outputDir, type: 'full' },
    });

    try {
      backgroundTaskManager.updateTask(taskId, 5, 'Preparing backup...');

      const result = await this._createArchive(zipPath, taskId, null);

      // Log the backup
      databaseService.logBackup({
        backupPath: zipPath,
        backupType: 'full',
        filesIncluded: result.filesIncluded,
        totalSize: result.totalSize,
      });

      backgroundTaskManager.completeTask(taskId, result);
      return { success: true, ...result };
    } catch (error) {
      backgroundTaskManager.failTask(taskId, error.message);
      log.error('[Backup] Full backup failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create an incremental backup (only files modified since last backup).
   * @param {string} outputDir - Directory to write the backup ZIP to
   * @param {string} [sinceDate] - ISO date string; defaults to last backup date
   * @returns {Promise<{ success: boolean, path: string, filesIncluded: number, totalSize: number }>}
   */
  async createIncrementalBackup(outputDir, sinceDate) {
    const lastBackup = databaseService.getLastBackup();
    const since = sinceDate
      ? new Date(sinceDate)
      : lastBackup
        ? new Date(lastBackup.created_at)
        : new Date(0);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipName = `jd-notes-incremental-${timestamp}.zip`;
    const zipPath = path.join(outputDir, zipName);

    const taskId = backgroundTaskManager.addTask({
      type: 'backup',
      description: 'Creating incremental backup...',
      metadata: { outputDir, type: 'incremental', since: since.toISOString() },
    });

    try {
      backgroundTaskManager.updateTask(taskId, 5, 'Scanning for changes...');

      const result = await this._createArchive(zipPath, taskId, since);

      if (result.filesIncluded === 0) {
        // Nothing to back up — remove empty zip
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        backgroundTaskManager.completeTask(taskId, { filesIncluded: 0, message: 'No changes since last backup' });
        return { success: true, filesIncluded: 0, totalSize: 0, message: 'No changes since last backup' };
      }

      databaseService.logBackup({
        backupPath: zipPath,
        backupType: 'incremental',
        filesIncluded: result.filesIncluded,
        totalSize: result.totalSize,
      });

      backgroundTaskManager.completeTask(taskId, result);
      return { success: true, ...result };
    } catch (error) {
      backgroundTaskManager.failTask(taskId, error.message);
      log.error('[Backup] Incremental backup failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Validate a backup archive by checking its manifest.
   * @param {string} backupPath - Path to the backup ZIP
   * @returns {Promise<{ valid: boolean, manifest: Object }>}
   */
  async validateBackup(backupPath) {
    try {
      if (!fs.existsSync(backupPath)) {
        return { valid: false, error: 'Backup file not found' };
      }

      const stat = fs.statSync(backupPath);
      if (stat.size === 0) {
        return { valid: false, error: 'Backup file is empty' };
      }

      // Try to read the manifest from the zip
      const unzipper = require('unzipper');
      const directory = await unzipper.Open.file(backupPath);
      const manifestEntry = directory.files.find(f => f.path === 'manifest.json');

      if (!manifestEntry) {
        return { valid: false, error: 'No manifest.json found in backup' };
      }

      const manifestBuffer = await manifestEntry.buffer();
      const manifest = JSON.parse(manifestBuffer.toString('utf-8'));

      // Check that expected files exist in the archive
      const archiveFiles = directory.files.map(f => f.path);
      const hasDatabase = archiveFiles.some(f => f.includes('database/meetings.db'));

      return {
        valid: true,
        manifest,
        hasDatabase,
        fileCount: directory.files.length,
        totalSize: stat.size,
      };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Restore from a backup archive.
   * @param {string} backupPath - Path to the backup ZIP
   * @param {{ restoreDatabase?: boolean, restoreConfig?: boolean, restoreAudio?: boolean }} options
   * @returns {Promise<{ success: boolean, restored: Object }>}
   */
  async restoreFromBackup(backupPath, options = {}) {
    const { restoreDatabase = true, restoreConfig = true, restoreAudio = false } = options;

    const taskId = backgroundTaskManager.addTask({
      type: 'restore',
      description: 'Restoring from backup...',
      metadata: { backupPath, options },
    });

    try {
      backgroundTaskManager.updateTask(taskId, 5, 'Validating backup...');

      const validation = await this.validateBackup(backupPath);
      if (!validation.valid) {
        throw new Error(`Invalid backup: ${validation.error}`);
      }

      const unzipper = require('unzipper');
      const directory = await unzipper.Open.file(backupPath);
      const restored = { database: false, config: 0, audio: 0 };

      backgroundTaskManager.updateTask(taskId, 20, 'Extracting files...');

      // Restore database
      if (restoreDatabase && validation.hasDatabase) {
        const dbEntry = directory.files.find(f => f.path === 'database/meetings.db');
        if (dbEntry) {
          const dbBuffer = await dbEntry.buffer();
          const dbPath = databaseService.dbPath;

          // Close the current database, clean up WAL/SHM, write the backup, then reinitialize
          databaseService.close();
          const walPath = dbPath + '-wal';
          const shmPath = dbPath + '-shm';
          if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
          if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
          fs.writeFileSync(dbPath, dbBuffer);
          databaseService.initialize();
          restored.database = true;
          log.info('[Backup] Database restored from backup');
        }
      }

      backgroundTaskManager.updateTask(taskId, 50, 'Restoring config files...');

      // Restore config files
      if (restoreConfig) {
        const userDataDir = path.resolve(app.getPath('userData'));
        const configFiles = directory.files.filter(f => f.path.startsWith('config/'));
        for (const entry of configFiles) {
          const destPath = path.resolve(path.join(userDataDir, entry.path));
          // Path traversal protection: ensure destPath is within userData
          if (!destPath.startsWith(userDataDir)) {
            log.warn(`[Backup] Skipping path traversal attempt: ${entry.path}`);
            continue;
          }
          const destDir = path.dirname(destPath);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          const buffer = await entry.buffer();
          fs.writeFileSync(destPath, buffer);
          restored.config++;
        }
        log.info(`[Backup] Restored ${restored.config} config files`);
      }

      backgroundTaskManager.updateTask(taskId, 80, 'Restoring audio files...');

      // Restore audio files
      if (restoreAudio) {
        // Parse manifest once before the loop
        const manifestEntry = directory.files.find(f => f.path === 'manifest.json');
        let audioManifest = null;
        if (manifestEntry) {
          audioManifest = JSON.parse((await manifestEntry.buffer()).toString('utf-8'));
        }

        if (audioManifest?.audio) {
          const audioFiles = directory.files.filter(f => f.path.startsWith('audio/'));
          // Build allow-list of known recording directories
          const userDataDir = path.resolve(app.getPath('userData'));
          for (const entry of audioFiles) {
            const audioInfo = audioManifest.audio.find(a => entry.path.endsWith(path.basename(a.originalPath)));
            if (audioInfo?.originalPath) {
              // Path traversal protection: only restore to userData or known recording paths
              const resolvedDest = path.resolve(audioInfo.originalPath);
              if (!resolvedDest.startsWith(userDataDir)) {
                log.warn(`[Backup] Skipping audio restore outside userData: ${audioInfo.originalPath}`);
                continue;
              }
              const destDir = path.dirname(resolvedDest);
              if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
              }
              const buffer = await entry.buffer();
              fs.writeFileSync(resolvedDest, buffer);
              restored.audio++;
            }
          }
        }
        log.info(`[Backup] Restored ${restored.audio} audio files`);
      }

      backgroundTaskManager.completeTask(taskId, restored);
      return { success: true, restored };
    } catch (error) {
      backgroundTaskManager.failTask(taskId, error.message);
      log.error('[Backup] Restore failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ======================================================================
  // Private helpers
  // ======================================================================

  /**
   * Create a ZIP archive with database, config, and audio files.
   * @param {string} zipPath - Output ZIP path
   * @param {string} taskId - Background task ID for progress updates
   * @param {Date|null} since - Only include files modified after this date (null = all)
   * @returns {Promise<{ path: string, filesIncluded: number, totalSize: number }>}
   */
  _createArchive(zipPath, taskId, since) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      let filesIncluded = 0;
      const manifest = {
        version: '1.4',
        createdAt: new Date().toISOString(),
        type: since ? 'incremental' : 'full',
        since: since ? since.toISOString() : null,
        database: null,
        config: [],
        audio: [],
      };

      output.on('close', () => {
        const totalSize = archive.pointer();
        resolve({ path: zipPath, filesIncluded, totalSize });
      });

      output.on('error', err => reject(err));
      archive.on('error', err => reject(err));
      archive.pipe(output);

      // 1. Database (always included in full backup, check mtime for incremental)
      const dbPath = databaseService.dbPath;
      if (dbPath && fs.existsSync(dbPath)) {
        const dbStat = fs.statSync(dbPath);
        if (!since || dbStat.mtime > since) {
          // WAL checkpoint for consistent copy
          databaseService.db.pragma('wal_checkpoint(TRUNCATE)');
          archive.file(dbPath, { name: 'database/meetings.db' });
          manifest.database = { size: dbStat.size };
          filesIncluded++;
          backgroundTaskManager.updateTask(taskId, 20, 'Database added to backup');
        }
      }

      // 2. Config files
      if (this.configDir && fs.existsSync(this.configDir)) {
        const configFiles = this._walkDir(this.configDir);
        for (const filePath of configFiles) {
          if (since) {
            const stat = fs.statSync(filePath);
            if (stat.mtime <= since) continue;
          }
          const relativePath = path.relative(this.configDir, filePath);
          archive.file(filePath, { name: `config/${relativePath}` });
          manifest.config.push({ relativePath, size: fs.statSync(filePath).size });
          filesIncluded++;
        }
        backgroundTaskManager.updateTask(taskId, 40, `${filesIncluded} config files added`);
      }

      // 3. Audio files
      const audioFiles = this._getAudioFilePaths();
      let audioAdded = 0;
      for (const filePath of audioFiles) {
        if (!fs.existsSync(filePath)) continue;
        const stat = fs.statSync(filePath);
        if (since && stat.mtime <= since) continue;

        const fileName = path.basename(filePath);
        const meetingDir = path.basename(path.dirname(filePath));
        archive.file(filePath, { name: `audio/${meetingDir}/${fileName}` });
        manifest.audio.push({ originalPath: filePath, size: stat.size });
        filesIncluded++;
        audioAdded++;

        // Update progress for large audio collections
        if (audioAdded % 5 === 0) {
          const progress = 40 + Math.min(40, (audioAdded / audioFiles.length) * 40);
          backgroundTaskManager.updateTask(taskId, Math.round(progress), `${audioAdded} audio files added`);
        }
      }

      backgroundTaskManager.updateTask(taskId, 85, 'Writing manifest...');

      // Add manifest
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      filesIncluded++;

      backgroundTaskManager.updateTask(taskId, 90, 'Finalizing archive...');
      archive.finalize();
    });
  }

  /**
   * Get all audio file paths referenced in the database.
   * @returns {string[]}
   */
  _getAudioFilePaths() {
    try {
      const rows = databaseService.db.prepare(
        'SELECT video_file FROM meetings WHERE video_file IS NOT NULL'
      ).all();
      return rows
        .map(r => r.video_file)
        .filter(p => p && fs.existsSync(p));
    } catch {
      return [];
    }
  }

  /**
   * Recursively walk a directory and return all file paths.
   * @param {string} dir
   * @returns {string[]}
   */
  _walkDir(dir) {
    const files = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...this._walkDir(fullPath));
        } else {
          files.push(fullPath);
        }
      }
    } catch {
      // Ignore permission errors
    }
    return files;
  }
}

// Singleton
const backupService = new BackupService();
module.exports = backupService;
