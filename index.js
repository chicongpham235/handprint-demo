var map;
var geocoder = new google.maps.Geocoder();
var infoWindow = new google.maps.InfoWindow({
  disableAutoPan: true,
});
var center = new google.maps.LatLng(38.78436574258653, -77.0150403423293);
var bounds = new google.maps.LatLngBounds();
var infowindow = new google.maps.InfoWindow();
var zoom = 6;
var dataProject;
var dataClient;

async function init() {
  await fetchData();

  var mapOptions = {
    minZoom: 1,
    maxZoom: 20,
    zoom: zoom,
    tilt: 45,
    center: center,
    mapTypeControl: true,
    clickableIcons: false,
    restriction: {
      latLngBounds: { north: 85, south: -85, west: -180, east: 180 },
    },
  };
  map = new google.maps.Map(document.getElementById("map"), mapOptions);
  const geojsons = dataProject
    .map((item) => {
      const temp = structuredClone(item);
      delete temp["map_coordinates"];
      item.map_coordinates.properties = {
        ...temp,
        total_quantity: item.unit_density_m2,
      };
      return item.map_coordinates;
    })
    .splice(0, 1);

  for (const g of geojsons) {
    const geojson = g.features[0];
    geojson.properties = {
      ...geojson.properties,
      color: "#ffffff",
      ...g.properties,
    };
    map.data.addGeoJson(g);
    map.data.setStyle(function (feature) {
      var color_property = feature.getProperty("color");
      return {
        fillColor: color_property,
        strokeWeight: 1,
      };
    });
    const area = turf.area(geojson);
    const areas = g.properties.clients.map((item) => {
      return (item.order_quantity / g.properties.total_quantity) * area;
    });
    const is_full_area =
      g.properties.clients.reduce(
        (accumulator, currentValue) =>
          accumulator + currentValue.order_quantity,
        0
      ) == g.properties.total_quantity;
    const epxilon = 0.01 * area;

    const polygonBbox = turf.bbox(geojson);
    const points = turf.randomPoint(10000, { bbox: polygonBbox });

    points.features = points.features.filter((feature) => {
      return turf.booleanPointInPolygon(feature.geometry.coordinates, geojson);
    });

    clustered = turf.clustersKmeans(points, {
      numberOfClusters: 100,
    });

    const clusterGroups = {};
    clustered.features.forEach((feature) => {
      if (!clusterGroups.hasOwnProperty(feature.properties.cluster)) {
        clusterGroups[feature.properties.cluster] = [];
      }
      clusterGroups[feature.properties.cluster].push(feature);
    });

    const centroids = [];
    Object.keys(clusterGroups).forEach((i) => {
      const features = clusterGroups[i];
      const centroid = turf.centroid({
        type: "FeatureCollection",
        features: features,
      });
      centroids.push(centroid);
    });

    voronoiPolygons = turf.voronoi(
      {
        type: "FeatureCollection",
        features: centroids,
      },
      {
        bbox: polygonBbox,
      }
    );

    const clipped = voronoiPolygons.features.map((feature) => {
      return turf.intersect(feature.geometry, geojson);
    });

    //  map.data.addGeoJson({
    //     type:"FeatureCollection",
    //     features:clipped
    //  });

    let temp_area = 0;
    const temp_polygon = [];
    const temp_layer = [];
    let idx = 0;

    for (const c of clipped) {
      if (idx == areas.length - 1 && is_full_area) {
        temp_polygon[idx] = temp_polygon.reduce((acc, polygon) => {
          const temp = turf.difference(
            turf.truncate(acc),
            turf.truncate(polygon)
          );
          return temp;
        }, geojson);
        const color = generateColor(g.properties.clients[idx].id);
        const properties = g.properties.clients[idx];
        temp_polygon[idx].properties = { ...properties, color: color };
        temp_layer[idx] = createLayer(map, temp_polygon[idx]);
        createClientContent(temp_layer[idx]);
        temp_layer[idx].forEach((feature) => {
          feature.getGeometry().forEachLatLng(function (latlng) {
            bounds.extend(latlng);
          });
        });
        break;
      }
      if (
        temp_area <= areas[idx] + epxilon &&
        temp_area >= areas[idx] - epxilon
      ) {
        const color = generateColor(g.properties.clients[idx].id);
        const properties = g.properties.clients[idx];
        temp_polygon[idx].properties = { ...properties, color: color };
        temp_layer[idx] = createLayer(map, temp_polygon[idx]);
        createClientContent(temp_layer[idx]);
        temp_layer[idx].forEach((feature) => {
          feature.getGeometry().forEachLatLng(function (latlng) {
            bounds.extend(latlng);
          });
        });
        temp_area = 0;
        idx++;
      } else {
        if (!temp_polygon[idx]) {
          temp_polygon[idx] = c;
        } else {
          try {
            temp_polygon[idx] = turf.union(
              turf.truncate(temp_polygon[idx]),
              turf.truncate(c)
            );
          } catch (error) {
            // console.log(error);
          }
        }
        temp_area += turf.area(c);
      }
    }
  }

  map.fitBounds(bounds);

  map.data.addListener("mousemove", function (event) {
    var feat = event.feature;
    var html =
      `<div style="font-weight:400">Project ID: <span style="font-weight:700">${feat.getProperty(
        "id"
      )}</span></div>` +
      `<div style="font-weight:400">Name: <span style="font-weight:300">${feat.getProperty(
        "name"
      )}</span></div>` +
      `<div style="font-weight:400">Category <span style="font-weight:300">${feat.getProperty(
        "category"
      )}</span></div>` +
      `<div style="font-weight:400">Total Capacity: <span style="font-weight: 300">${feat.getProperty(
        "total_capacity"
      )}</span></div>` +
      `<div style="font-weight:400">Unit Density m<sup>2</sup>: <span style="font-weight: 300">${feat.getProperty(
        "unit_density_m2"
      )}</span></div>`;
    infowindow.setContent(html);
    infowindow.setPosition(event.latLng);
    infowindow.setOptions({ pixelOffset: new google.maps.Size(0, -34) });
    infowindow.open(map);
  });

  map.data.addListener("mouseout", function () {
    infowindow.close();
  });
}

function createClientContent(layer) {
  layer.addListener("mousemove", function (event) {
    var feat = event.feature;
    var html =
      `<div style="font-weight: 400">Client ID: <span style="font-weight:700">${feat.getProperty(
        "id"
      )}</span></div>` +
      `<div style="font-weight: 400">Order Quantity: <span style="font-weight: 300">${feat.getProperty(
        "order_quantity"
      )}</span></div>`;
    infowindow.setContent(html);
    infowindow.setPosition(event.latLng);
    infowindow.setOptions({ pixelOffset: new google.maps.Size(0, -34) });
    infowindow.open(map);
  });

  layer.addListener("mouseout", function () {
    infowindow.close();
  });
}

function createLayer(map, geojson) {
  const layer = new google.maps.Data({ map: map });
  layer.addGeoJson(geojson);
  layer.setStyle({
    fillColor: geojson.properties.color ?? "#ffffff",
    strokeWeight: 0,
  });
  layer.setMap(map);
  return layer;
}

async function fetchData() {
  dataProject = await fetch("./data/projects.json").then((res) => res.json());
  dataClient = await fetch("./data/client_orders.json").then((res) =>
    res.json()
  );
  dataProject = dataProject.map((item) => {
    const client_orders = dataClient.filter((x) => x.project_id == item.id);
    return { ...item, clients: client_orders };
  });
}

window.onload = () => {
  init();
};

function generateColor(integer) {
  var color = "#" + (integer * 1234567890).toString(16).slice(0, 6);
  return color;
}
