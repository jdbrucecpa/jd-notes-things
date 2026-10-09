import { describe, it, expect, vi } from 'vitest';

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { default: keyManagementService } =
  await import('../../src/main/services/keyManagementService.js');

describe('keyManagementService HF_TOKEN', () => {
  it('lists the Hugging Face token alongside the other keys (Security tab)', () => {
    expect(keyManagementService.keyTypes.HF_TOKEN).toMatch(/Hugging Face/);
  });

  it('accepts tokens with the hf_ prefix', () => {
    expect(keyManagementService.validateKey('HF_TOKEN', 'hf_abcdefghijklmnop').valid).toBe(true);
  });

  it('rejects values without the hf_ prefix', () => {
    const result = keyManagementService.validateKey('HF_TOKEN', 'abcdefghijklmnop');
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/hf_/);
  });
});
