import * as ImageManipulator from 'expo-image-manipulator';
import { UIImagePickerPreferredAssetRepresentationMode, launchImageLibraryAsync } from 'expo-image-picker';

// Request a decoded representation instead of the iOS original-file fast copy,
// which can return an empty file from the system photo provider.
export const photoRepresentation = UIImagePickerPreferredAssetRepresentationMode.Compatible;

export async function prepareJpeg(uri: string, actions: Parameters<typeof ImageManipulator.manipulateAsync>[1]) {
  try {
    return await ImageManipulator.manipulateAsync(uri, actions, { compress: .74, format: ImageManipulator.SaveFormat.JPEG });
  } catch {
    // Native exceptions include local paths and implementation details.
    throw new Error('Cette photo n’a pas pu être préparée. Réessayez ou choisissez une autre image.');
  }
}

/** The native picker can reject with an empty message or an implementation detail. */
export async function selectLibraryPhoto() {
  try {
    return await launchImageLibraryAsync({ preferredAssetRepresentationMode: photoRepresentation, mediaTypes: ['images'], quality: 1, allowsMultipleSelection: false });
  } catch {
    throw new Error('Cette photo n’a pas pu être sélectionnée. Réessayez ou choisissez une autre image.');
  }
}
