import { AESEncryptionKey, AESKeySize, AESSealedData, aesDecryptAsync, aesEncryptAsync, randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { PendingPhoto } from './intervention-drafts';

const maxPhotoBytes = 4194304;
const photoDirectory = () => new Directory(Paths.document, 'report-photo-drafts');
const encryptedFile = (id: string) => new File(photoDirectory(), id + '.sealed');

export async function stageReportPhoto(source: File): Promise<PendingPhoto> {
  if (!source.size || source.size > maxPhotoBytes)
    throw new Error('Cette photo dépasse la limite de 4 Mo après conversion.');
  const key = await AESEncryptionKey.generate(AESKeySize.AES256);
  const sealed = await aesEncryptAsync(await source.bytes(), key);
  const bytes = await sealed.combined();
  const reference = { fileId: randomUUID(), key: await key.encoded('base64') };
  photoDirectory().create({ idempotent: true, intermediates: true });
  const file = encryptedFile(reference.fileId);
  file.create();
  file.write(bytes);
  return reference;
}

export async function openReportPhoto(photo: PendingPhoto) {
  const file = encryptedFile(photo.fileId);
  if (!file.exists || file.size <= 28 || file.size > maxPhotoBytes + 28)
    throw new Error('Cette photo ne peut plus être lue. Sélectionnez-la de nouveau.');
  const key = await AESEncryptionKey.import(photo.key, 'base64');
  const bytes = await aesDecryptAsync(AESSealedData.fromCombined(await file.bytes()), key);
  const temporary = new File(Paths.cache, `report-upload-${randomUUID()}.jpg`);
  temporary.create();
  try {
    temporary.write(bytes);
    return temporary;
  } catch (error) {
    discardTemporaryPhoto(temporary);
    throw error;
  }
}

export function discardTemporaryPhoto(file: File) {
  try { if (file.exists) file.delete(); } catch { /* Cache cleanup may be retried by the OS. */ }
}

export function releaseReportPhoto(photo: PendingPhoto) {
  discardTemporaryPhoto(encryptedFile(photo.fileId));
}
