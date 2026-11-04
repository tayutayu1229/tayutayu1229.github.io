(function (global) {
  'use strict';
  const GSI_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';
  const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

  function createLayer(style = 'pale') {
    const layer = global.L.tileLayer(`https://cyberjapandata.gsi.go.jp/xyz/${style === 'std' ? 'std' : 'pale'}/{z}/{x}/{y}.png`, {
      minZoom: 2, maxZoom: 20, maxNativeZoom: 18, attribution: GSI_ATTRIBUTION,
    });
    let errors = 0;
    let fallback = false;
    layer.on('tileload', () => { errors = 0; });
    layer.on('tileerror', () => {
      if (fallback || ++errors < 3) return;
      fallback = true;
      const control = layer._map?.attributionControl;
      control?.removeAttribution(GSI_ATTRIBUTION);
      layer.options.attribution = OSM_ATTRIBUTION;
      control?.addAttribution(OSM_ATTRIBUTION);
      layer.options.maxNativeZoom = 19;
      layer.setUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    });
    return layer;
  }
  global.TayunetBaseMap = Object.freeze({createLayer});
})(window);
