import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { useTheme } from '@/hooks/use-theme';

export interface LiveMapProps {
  coordinates: { latitude: number; longitude: number; timestamp: number }[];
  isActive: boolean;
  style?: object;
}

const FOLLOW_ZOOM = 17;

/**
 * OpenStreetMap (Leaflet) implementation rendered in a WebView.
 * Works inside Expo Go without any native Google Maps API key.
 *
 * NOTE: The previous react-native-maps (Google Maps) implementation is kept
 * commented out at the bottom of this file. To switch back to Google Maps,
 * restore that component and add your key under `expo.android.config.googleMaps.apiKey`
 * in app.json, then rebuild the native dev client.
 */
export default function LiveMap({ coordinates, isActive, style }: LiveMapProps) {
  const colors = useTheme();
  const webViewRef = useRef<WebView | null>(null);
  const coordsRef = useRef(coordinates);
  const hasFitRef = useRef(false);

  coordsRef.current = coordinates;

  const last = coordinates.length > 0 ? coordinates[coordinates.length - 1] : null;

  const leafletHtml = useMemo(() => buildLeafletHtml(colors.primary), [colors.primary]);

  // Push the latest route + position into the Leaflet map.
  const pushRoute = () => {
    const coords = coordsRef.current;
    if (coords.length === 0 || !webViewRef.current) return;
    const route = coords.map((c) => [c.latitude, c.longitude]);
    const fit = !hasFitRef.current;
    hasFitRef.current = true;
    webViewRef.current.injectJavaScript(
      `window.updateRoute(${JSON.stringify(route)}, ${fit ? 'true' : 'false'}); true;`
    );
  };

  useEffect(() => {
    pushRoute();
  }, [coordinates]);

  if (!last) {
    return (
      <View
        style={[styles.placeholder, style, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}
      >
        <Text style={[styles.placeholderText, { color: colors.textSecondary }]}>
          {isActive ? 'Waiting for GPS fix...' : 'Location paused'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.mapContainer, style, { borderColor: colors.cardBorder }]}>
      <WebView
        ref={webViewRef}
        source={{ html: leafletHtml }}
        style={styles.map}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        cacheEnabled={false}
        onLoadEnd={pushRoute}
      />

      {isActive && (
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      )}
    </View>
  );
}

// Builds the standalone Leaflet page injected into the WebView.
function buildLeafletHtml(primaryColor: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; }
    .leaflet-container { background: #10131a; font-family: inherit; }
    .leaflet-control-attribution { font-size: 8px; opacity: 0.6; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: false, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    var routeLine = null;
    var positionMarker = null;

    window.updateRoute = function (route, fit) {
      if (!route || route.length === 0) return;

      if (routeLine) {
        routeLine.setLatLngs(route);
      } else {
        routeLine = L.polyline(route, {
          color: '${primaryColor}',
          weight: 4,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(map);
      }

      var head = route[route.length - 1];
      if (!positionMarker) {
        positionMarker = L.circleMarker(head, {
          radius: 7,
          color: '#ffffff',
          weight: 3,
          fillColor: '${primaryColor}',
          fillOpacity: 1
        }).addTo(map);
      } else {
        positionMarker.setLatLng(head);
      }

      if (fit && route.length === 1) {
        map.setView(head, ${FOLLOW_ZOOM});
      } else if (fit) {
        map.fitBounds(routeLine.getBounds(), { padding: [24, 24] });
      } else if (!map.getBounds().pad(-0.15).contains(head)) {
        map.panTo(head);
      }
    };
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
  },
  placeholderText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  mapContainer: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  map: {
    flex: 1,
    backgroundColor: '#10131a',
  },
  liveBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#1DB95415',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1DB954',
  },
  liveText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1DB954',
    letterSpacing: 0.5,
  },
});

/*
 * ---------------------------------------------------------------------------
 * Previous Google Maps implementation (react-native-maps).
 * Kept for reference — restore this component to switch back to Google Maps.
 * Requires expo.android.config.googleMaps.apiKey in app.json plus a native
 * dev-client rebuild (npx expo run:android). Does NOT work inside Expo Go.
 * ---------------------------------------------------------------------------
 *
 * import MapView, { Marker, Polyline } from 'react-native-maps';
 *
 * export default function LiveMap({ coordinates, isActive, style }: LiveMapProps) {
 *   const colors = useTheme();
 *   const mapRef = useRef<MapView | null>(null);
 *   const lastFollowedRef = useRef<{ latitude: number; longitude: number } | null>(null);
 *
 *   const last = coordinates.length > 0 ? coordinates[coordinates.length - 1] : null;
 *   const lastLat = last?.latitude;
 *   const lastLng = last?.longitude;
 *
 *   // Keep the camera following the user's latest GPS fix (skip repeats).
 *   useEffect(() => {
 *     if (lastLat == null || lastLng == null || !mapRef.current) return;
 *     const current = { latitude: lastLat, longitude: lastLng };
 *     if (lastFollowedRef.current && lastFollowedRef.current.latitude === current.latitude && lastFollowedRef.current.longitude === current.longitude) {
 *       return;
 *     }
 *     lastFollowedRef.current = current;
 *     mapRef.current.animateToRegion(
 *       {
 *         ...current,
 *         latitudeDelta: REGION_DELTA,
 *         longitudeDelta: REGION_DELTA,
 *       },
 *       400
 *     );
 *   }, [lastLat, lastLng]);
 *
 *   if (!last) {
 *     return (
 *       <View
 *         style={[styles.placeholder, style, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}
 *       >
 *         <Text style={[styles.placeholderText, { color: colors.textSecondary }]}>
 *           {isActive ? 'Waiting for GPS fix...' : 'Location paused'}
 *         </Text>
 *       </View>
 *     );
 *   }
 *
 *   const route = coordinates.map((c) => ({ latitude: c.latitude, longitude: c.longitude }));
 *   const currentPos = { latitude: last.latitude, longitude: last.longitude };
 *
 *   return (
 *     <View style={[styles.mapContainer, style, { borderColor: colors.cardBorder }]}>
 *       <MapView
 *         ref={mapRef}
 *         style={styles.map}
 *         initialRegion={{ ...currentPos, latitudeDelta: REGION_DELTA, longitudeDelta: REGION_DELTA }}
 *         showsUserLocation
 *         showsCompass={false}
 *         toolbarEnabled={false}
 *         loadingEnabled
 *         loadingBackgroundColor={colors.backgroundElement}
 *         loadingIndicatorColor={colors.primary}
 *       >
 *         {route.length > 1 && (
 *           <Polyline
 *             coordinates={route}
 *             strokeColor={colors.primary}
 *             strokeWidth={4}
 *             lineCap="round"
 *             lineJoin="round"
 *           />
 *         )}
 *         <Marker coordinate={currentPos} anchor={{ x: 0.5, y: 0.5 }} title="You">
 *           <View style={[styles.markerPin, { borderColor: colors.background }]}>
 *             <View style={[styles.markerPinInner, { backgroundColor: colors.primary }]} />
 *           </View>
 *         </Marker>
 *       </MapView>
 *
 *       {isActive && (
 *         <View style={styles.liveBadge}>
 *           <View style={styles.liveDot} />
 *           <Text style={styles.liveText}>LIVE</Text>
 *         </View>
 *       )}
 *     </View>
 *   );
 * }
 *
 * const REGION_DELTA = 0.004;
 */
