/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dynamic config so the (optional) Google Maps keys can come from the
// environment instead of being committed.
//
// Android renders Google tiles in Expo Go without a key and needs one only for
// a standalone build. iOS ships Apple Maps by default: supply the iOS key and
// the app switches to Google there too, so every screen in the product — the
// customer's map, the courier's, the supervisor's console — draws the same
// roads. See `src/mapProvider.ts`.
const googleMapsAndroidKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY || '';
const googleMapsIosKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY || '';

/**
 * The customer app ships beside the rider app, not instead of it: a different
 * bundle id, a different scheme and a different slug, so both can sit on one
 * device during a demo without one replacing the other.
 *
 * @type {import('expo/config').ExpoConfig}
 */
module.exports = {
  name: 'FreshFold',
  slug: 'freshfold-client',
  // The Expo account that owns the EAS project. Named here rather than left to
  // `eas init`, which cannot safely edit a dynamic config like this one.
  owner: 'ben-arch',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'freshfoldclient',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  backgroundColor: '#FAF9F6',
  splash: {
    backgroundColor: '#FAF9F6',
    resizeMode: 'contain',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.freshfold.client',
    ...(googleMapsIosKey ? { config: { googleMapsApiKey: googleMapsIosKey } } : {}),
    infoPlist: {
      NSCameraUsageDescription:
        'FreshFold uses the camera to scan your laundry bag QR codes and photograph a garment when you report an issue.',
      NSLocationWhenInUseUsageDescription:
        'FreshFold uses your location to set the pickup pin and show your courier approaching in real time.',
      NSFaceIDUsageDescription:
        'FreshFold uses Face ID to unlock your account without re-entering your password.',
    },
  },
  android: {
    package: 'com.freshfold.client',
    edgeToEdgeEnabled: true,
    adaptiveIcon: { backgroundColor: '#5A6B4F' },
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
          'FreshFold uses the camera to scan bag QR codes and photograph garments when you report an issue.',
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'FreshFold uses your location to set the pickup pin and follow your courier on the map.',
      },
    ],
    [
      'expo-local-authentication',
      {
        faceIDPermission:
          'FreshFold uses Face ID to unlock your account without re-entering your password.',
      },
    ],
  ],
  // The EAS project this app builds under. `eas init` created
  // @ben-arch/freshfold-client but could not write the id back: it will not
  // edit a dynamic config it cannot safely parse, and says so rather than
  // guessing. Pasted by hand instead, which is what that message asks for.
  extra: {
    eas: {
      projectId: '18b10d74-5701-4db1-8dbd-4a2dcc559d63',
    },
  },
  experiments: {
    typedRoutes: true,
  },
};
