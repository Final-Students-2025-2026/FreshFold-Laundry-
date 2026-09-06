/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dynamic config so the (optional) Google Maps keys can come from the
// environment instead of being committed.
//
// Android renders Google tiles in Expo Go without a key and needs one only for
// a standalone build. iOS ships Apple Maps by default: supply the iOS key and
// the console switches to Google there too, so the courier and the customer
// are looking at the same roads. See `src/mapProvider.ts`.
const googleMapsAndroidKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY || '';
const googleMapsIosKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY || '';

/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  name: 'FreshFold Dispatch',
  slug: 'freshfold-dispatch',
  // The Expo account that owns the EAS project. Named here rather than left to
  // `eas init`, which cannot safely edit a dynamic config like this one.
  owner: 'ben-arch',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'freshfold',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  backgroundColor: '#FAF9F6',
  splash: {
    backgroundColor: '#FAF9F6',
    resizeMode: 'contain',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.freshfold.dispatch',
    ...(googleMapsIosKey ? { config: { googleMapsApiKey: googleMapsIosKey } } : {}),
    infoPlist: {
      NSCameraUsageDescription:
        'FreshFold uses the camera to scan laundry bag QR codes and document garment condition at pickup and delivery.',
      NSLocationWhenInUseUsageDescription:
        'FreshFold tracks your location during an active shift so dispatch can route you to pickups and deliveries.',
      NSFaceIDUsageDescription:
        'FreshFold uses Face ID to unlock the rider console without re-entering your access PIN.',
    },
  },
  android: {
    package: 'com.freshfold.dispatch',
    edgeToEdgeEnabled: true,
    adaptiveIcon: { backgroundColor: '#6F7A63' },
    permissions: [
      'android.permission.CAMERA',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
    ],
    ...(googleMapsAndroidKey
      ? { config: { googleMaps: { apiKey: googleMapsAndroidKey } } }
      : {}),
  },
  web: {
    bundler: 'metro',
    output: 'static',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-camera',
      {
        cameraPermission:
          'FreshFold uses the camera to scan bag QR codes and capture proof-of-service photos.',
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'FreshFold tracks your location during an active shift to route you to pickups and deliveries.',
      },
    ],
    [
      'expo-local-authentication',
      {
        faceIDPermission:
          'FreshFold uses Face ID to unlock the rider console without re-entering your access PIN.',
      },
    ],
  ],
  // The EAS project this app builds under. `eas init` created
  // @ben-arch/freshfold-dispatch but could not write the id back: it will not
  // edit a dynamic config it cannot safely parse, and says so rather than
  // guessing. Pasted by hand instead, which is what that message asks for.
  extra: {
    eas: {
      projectId: '22d8cde3-6143-48d5-9f22-dba5da8e73b7',
    },
  },
  experiments: {
    typedRoutes: true,
  },
};
