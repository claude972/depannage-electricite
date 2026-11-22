import { Platform } from 'react-native';
import { File } from 'expo-file-system';

// Expo fetch reads File.bytes(). Keep a stable multipart filename for receipt
// recovery without renaming or deleting the temporary file owned by the caller.
class NamedUploadFile extends File {
  constructor(uri: string, private readonly uploadName: string) { super(uri); }
  override get name() { return this.uploadName; }
}

export async function createJpegUpload(interventionId: string, file: { uri?: string; arrayBuffer(): Promise<ArrayBuffer> }, name: string): Promise<FormData> {
  const body = new FormData();
  body.append('intervention_id', interventionId);
  if (Platform.OS === 'web') {
    body.append('file', new Blob([await file.arrayBuffer()], { type: 'image/jpeg' }), name);
  } else {
    if (!file.uri) throw new Error('La photo locale est indisponible.');
    // A uri-only RN part is rejected by Expo fetch. RN Blob also cannot be
    // constructed from ArrayBuffer: pass the supported Expo File itself.
    body.append('file', new NamedUploadFile(file.uri, name));
  }
  return body;
}
