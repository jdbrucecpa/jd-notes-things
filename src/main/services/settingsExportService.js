/**
 * Settings Export/Import Service - SE-1 & SE-2
 * Handles exporting and importing app configuration for backup/transfer.
 *
 * Export includes:
 * - Routing rules (routing.yaml)
 * - Vocabulary lists (vocabulary.yaml)
 * - Transcript patterns (transcript-patterns.yaml)
 * - Summary templates (config/templates/*)
 * - App preferences (app-settings.json)
 * - Speaker ID mappings (speaker-mappings.json)
 *
 * Does NOT export (security):
 * - Google OAuth tokens
 * - API keys
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const archiver = require('archiver');
const unzipper = require('unzipper');

const LOG_PREFIX = '[SettingsExport]';

class SettingsExportService {
  constructor() {
    // User data directory - all config files live here (both dev and prod)
    // Dev: AppData/Roaming/jd-notes-things-dev/
    // Prod: AppData/Roaming/jd-notes-things/
    this.userDataPath = app.getPath('userData');

    // Config directory inside userData
    this.configPath = path.join(this.userDataPath, 'config');

    console.log(`${LOG_PREFIX} Config path:`, this.configPath);
  }

  /**
   * Get paths to all exportable files
   * @returns {Object} Object with file paths organized by category
   */
  getExportablePaths() {
    return {
      // Config files in userData/config/
      config: {
        routing: path.join(this.configPath, 'routing.yaml'),
        vocabulary: path.join(this.configPath, 'vocabulary.yaml'),
        transcriptPatterns: path.join(this.configPath, 'transcript-patterns.yaml'),
      },

      // Templates directory in userData/config/templates/
      templates: path.join(this.configPath, 'templates'),

      // User data files in config/
      userData: {
        appSettings: path.join(this.configPath, 'app-settings.json'),
        speakerMappings: path.join(this.configPath, 'speaker-mappings.json'),
      },
    };
  }

  /**
   * Collect all files for export
   * @returns {Object} Object with file contents and metadata
   */
  async collectExportData() {
    const paths = this.getExportablePaths();
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      files: {},
      templates: [],
      manifest: {
        included: [],
        excluded: ['google-token.json', 'API keys (stored in Windows Credential Manager)'],
        warnings: [],
      },
    };

    // Collect core config files
    for (const [name, filePath] of Object.entries(paths.config)) {
      if (fs.existsSync(filePath)) {
        try {
          data.files[name] = fs.readFileSync(filePath, 'utf8');
          data.manifest.included.push(`config/${path.basename(filePath)}`);
          console.log(`${LOG_PREFIX} Collected: ${name}`);
        } catch (error) {
          console.error(`${LOG_PREFIX} Failed to read ${name}:`, error.message);
          data.manifest.warnings.push(`Failed to read ${name}: ${error.message}`);
        }
      } else {
        console.log(`${LOG_PREFIX} File not found (skipping): ${name}`);
      }
    }

    // Collect user data files
    for (const [name, filePath] of Object.entries(paths.userData)) {
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          data.files[name] = content;
          data.manifest.included.push(path.basename(filePath));
          console.log(`${LOG_PREFIX} Collected: ${name}`);
        } catch (error) {
          console.error(`${LOG_PREFIX} Failed to read ${name}:`, error.message);
          data.manifest.warnings.push(`Failed to read ${name}: ${error.message}`);
        }
      }
    }

    // Collect templates from config/templates
    if (fs.existsSync(paths.templates)) {
      const templateFiles = fs.readdirSync(paths.templates);
      for (const file of templateFiles) {
        const filePath = path.join(paths.templates, file);
        if (fs.statSync(filePath).isFile()) {
          try {
            data.templates.push({
              name: file,
              content: fs.readFileSync(filePath, 'utf8'),
            });
            data.manifest.included.push(`templates/${file}`);
            console.log(`${LOG_PREFIX} Collected template: ${file}`);
          } catch (error) {
            console.error(`${LOG_PREFIX} Failed to read template ${file}:`, error.message);
            data.manifest.warnings.push(`Failed to read template ${file}: ${error.message}`);
          }
        }
      }
    } else {
      console.log(`${LOG_PREFIX} Templates directory not found: ${paths.templates}`);
      data.manifest.warnings.push('Templates directory not found');
    }

    console.log(`${LOG_PREFIX} Collected ${data.manifest.included.length} files for export`);
    return data;
  }

  /**
   * Export settings to a ZIP file
   * @param {string} outputPath - Path for the ZIP file
   * @returns {Promise<Object>} Export result with path and manifest
   */
  async exportToZip(outputPath) {
    console.log(`${LOG_PREFIX} Starting export to: ${outputPath}`);

    // Collect data first (async operation)
    const data = await this.collectExportData();

    // Then create the archive (stream-based operation wrapped in Promise)
    return new Promise((resolve, reject) => {
      // Create write stream
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', {
        zlib: { level: 9 }, // Maximum compression
      });

      // Handle stream events
      output.on('close', () => {
        const size = archive.pointer();
        console.log(`${LOG_PREFIX} Export complete: ${(size / 1024).toFixed(2)} KB`);
        resolve({
          success: true,
          path: outputPath,
          size: size,
          manifest: data.manifest,
        });
      });

      archive.on('error', err => {
        console.error(`${LOG_PREFIX} Archive error:`, err);
        reject(err);
      });

      // Pipe archive to file
      archive.pipe(output);

      // Add manifest.json
      archive.append(JSON.stringify(data.manifest, null, 2), { name: 'manifest.json' });

      // Add config files
      if (data.files.routing) {
        archive.append(data.files.routing, { name: 'config/routing.yaml' });
      }
      if (data.files.vocabulary) {
        archive.append(data.files.vocabulary, { name: 'config/vocabulary.yaml' });
      }
      if (data.files.transcriptPatterns) {
        archive.append(data.files.transcriptPatterns, { name: 'config/transcript-patterns.yaml' });
      }

      // Add user data files
      if (data.files.appSettings) {
        archive.append(data.files.appSettings, { name: 'app-settings.json' });
      }
      if (data.files.speakerMappings) {
        archive.append(data.files.speakerMappings, { name: 'speaker-mappings.json' });
      }

      // Add templates
      for (const template of data.templates) {
        archive.append(template.content, { name: `templates/${template.name}` });
      }

      // Finalize archive
      archive.finalize();
    });
  }

  /**
   * Generate default export filename with timestamp
   * @returns {string} Filename like "jd-notes-settings-2024-01-15-143022.zip"
   */
  generateExportFilename() {
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[:.]/g, '')
      .replace('T', '-')
      .slice(0, 15);
    return `jd-notes-settings-${timestamp}.zip`;
  }

  /**
   * Preview what would be exported (for UI display)
   * @returns {Object} Preview of export contents
   */
  async getExportPreview() {
    const paths = this.getExportablePaths();
    const preview = {
      configFiles: [],
      templates: [],
      userDataFiles: [],
      excluded: ['google-token.json', 'API keys'],
    };

    // Check config files
    for (const [_name, filePath] of Object.entries(paths.config)) {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        preview.configFiles.push({
          name: path.basename(filePath),
          size: stats.size,
          modified: stats.mtime,
        });
      }
    }

    // Check templates
    if (fs.existsSync(paths.templates)) {
      const files = fs.readdirSync(paths.templates);
      for (const file of files) {
        const filePath = path.join(paths.templates, file);
        if (fs.statSync(filePath).isFile()) {
          preview.templates.push(file);
        }
      }
    }

    // Check user data files
    for (const [_name, filePath] of Object.entries(paths.userData)) {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        preview.userDataFiles.push({
          name: path.basename(filePath),
          size: stats.size,
          modified: stats.mtime,
        });
      }
    }

    return preview;
  }

  /**
   * Import settings from a ZIP file
   * @param {string} zipPath - Path to the ZIP file
   * @param {Object} options - Import options
   * @param {boolean} options.overwrite - Overwrite existing files (default: false, will merge)
   * @param {boolean} options.skipTemplates - Skip importing templates
   * @param {boolean} options.skipConfig - Skip importing config files
   * @param {boolean} options.skipUserData - Skip importing user data files
   * @returns {Promise<Object>} Import result
   */
  async importFromZip(zipPath, options = {}) {
    const {
      overwrite = false,
      skipTemplates = false,
      skipConfig = false,
      skipUserData = false,
    } = options;

    console.log(`${LOG_PREFIX} Starting import from: ${zipPath}`);
    console.log(`${LOG_PREFIX} Options:`, { overwrite, skipTemplates, skipConfig, skipUserData });

    const result = {
      success: true,
      imported: [],
      skipped: [],
      errors: [],
      manifest: null,
    };

    try {
      // Read and parse the ZIP file
      const directory = await unzipper.Open.file(zipPath);

      // Find and read manifest first
      const manifestFile = directory.files.find(f => f.path === 'manifest.json');
      if (manifestFile) {
        const manifestContent = await manifestFile.buffer();
        result.manifest = JSON.parse(manifestContent.toString());
        console.log(`${LOG_PREFIX} Found manifest from ${result.manifest.exportedAt}`);
      }

      // Process each file in the archive
      for (const file of directory.files) {
        if (file.type === 'Directory') continue;

        const fileName = file.path;

        try {
          // Config files
          if (fileName.startsWith('config/') && !skipConfig) {
            await this._importConfigFile(file, overwrite, result);
          }
          // Templates
          else if (fileName.startsWith('templates/') && !skipTemplates) {
            await this._importTemplateFile(file, overwrite, result);
          }
          // User data files
          else if (!skipUserData && ['app-settings.json', 'speaker-mappings.json'].includes(fileName)) {
            await this._importUserDataFile(file, overwrite, result);
          }
          // Manifest (already processed)
          else if (fileName === 'manifest.json') {
            // Skip, already processed
          }
          // Unknown files
          else {
            result.skipped.push({ file: fileName, reason: 'Unknown file type' });
          }
        } catch (error) {
          console.error(`${LOG_PREFIX} Error importing ${fileName}:`, error);
          result.errors.push({ file: fileName, error: error.message });
        }
      }

      console.log(`${LOG_PREFIX} Import complete: ${result.imported.length} imported, ${result.skipped.length} skipped, ${result.errors.length} errors`);

      if (result.errors.length > 0) {
        result.success = false;
      }

      return result;
    } catch (error) {
      console.error(`${LOG_PREFIX} Import failed:`, error);
      return {
        success: false,
        imported: [],
        skipped: [],
        errors: [{ file: zipPath, error: error.message }],
        manifest: null,
      };
    }
  }

  /**
   * Import a config file from the archive
   * @private
   */
  async _importConfigFile(file, overwrite, result) {
    const fileName = path.basename(file.path);
    const destPath = path.join(this.configPath, fileName);

    // Ensure config directory exists
    if (!fs.existsSync(this.configPath)) {
      fs.mkdirSync(this.configPath, { recursive: true });
    }

    if (fs.existsSync(destPath) && !overwrite) {
      // Merge instead of overwrite for YAML files
      if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
        result.skipped.push({ file: file.path, reason: 'File exists (use overwrite to replace)' });
        return;
      }
    }

    const content = await file.buffer();
    fs.writeFileSync(destPath, content);
    result.imported.push(file.path);
    console.log(`${LOG_PREFIX} Imported config: ${fileName}`);
  }

  /**
   * Import a template file from the archive
   * @private
   */
  async _importTemplateFile(file, overwrite, result) {
    const fileName = path.basename(file.path);
    const destPath = path.join(this.configPath, 'templates', fileName);

    // Ensure templates directory exists
    const templatesDir = path.dirname(destPath);
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
    }

    if (fs.existsSync(destPath) && !overwrite) {
      result.skipped.push({ file: file.path, reason: 'Template exists (use overwrite to replace)' });
      return;
    }

    const content = await file.buffer();
    fs.writeFileSync(destPath, content);
    result.imported.push(file.path);
    console.log(`${LOG_PREFIX} Imported template: ${fileName}`);
  }

  /**
   * Import a user data file from the archive
   * @private
   */
  async _importUserDataFile(file, overwrite, result) {
    const fileName = path.basename(file.path);
    const destPath = path.join(this.userDataPath, fileName);

    if (fs.existsSync(destPath) && !overwrite) {
      // For JSON files, attempt to merge
      if (fileName.endsWith('.json')) {
        try {
          const existing = JSON.parse(fs.readFileSync(destPath, 'utf8'));
          const imported = JSON.parse((await file.buffer()).toString());

          // Merge objects (imported values take precedence)
          const merged = this._deepMerge(existing, imported);
          fs.writeFileSync(destPath, JSON.stringify(merged, null, 2));
          result.imported.push(`${file.path} (merged)`);
          console.log(`${LOG_PREFIX} Merged user data: ${fileName}`);
          return;
        } catch {
          result.skipped.push({ file: file.path, reason: 'Merge failed, file exists' });
          return;
        }
      }

      result.skipped.push({ file: file.path, reason: 'File exists (use overwrite to replace)' });
      return;
    }

    const content = await file.buffer();
    fs.writeFileSync(destPath, content);
    result.imported.push(file.path);
    console.log(`${LOG_PREFIX} Imported user data: ${fileName}`);
  }

  /**
   * Deep merge two objects
   * @private
   */
  _deepMerge(target, source) {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
          result[key] = this._deepMerge(target[key], source[key]);
        } else {
          result[key] = source[key];
        }
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  /**
   * Validate a ZIP file before import
   * @param {string} zipPath - Path to the ZIP file
   * @returns {Promise<Object>} Validation result
   */
  async validateImportFile(zipPath) {
    try {
      const directory = await unzipper.Open.file(zipPath);

      const hasManifest = directory.files.some(f => f.path === 'manifest.json');
      const hasConfig = directory.files.some(f => f.path.startsWith('config/'));
      const hasTemplates = directory.files.some(f => f.path.startsWith('templates/'));

      let manifest = null;
      if (hasManifest) {
        const manifestFile = directory.files.find(f => f.path === 'manifest.json');
        const content = await manifestFile.buffer();
        manifest = JSON.parse(content.toString());
      }

      return {
        valid: true,
        hasManifest,
        hasConfig,
        hasTemplates,
        manifest,
        fileCount: directory.files.filter(f => f.type !== 'Directory').length,
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
      };
    }
  }
}

// Export singleton instance
const settingsExportService = new SettingsExportService();
module.exports = settingsExportService;
