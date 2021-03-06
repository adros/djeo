define([
	"require",
	"dojo/_base/declare", // declare
	"dojo/has",
	"dojo/_base/lang", // mixin, isString, hitch
	"dojo/_base/array", // forEach
	"dojo/dom-construct", // create
	"dojo/dom-geometry",
	"dojo/on",
	"../_base",
	"../dojox/gfx",
	"../dojox/gfx/matrix",
	"../Engine",
	"./Placemark",
	"../util/geometry",
	"../_tiles"
], function(require, declare, has, lang, array, domConstruct, domGeom, on, djeo, gfx, matrix, Engine, Placemark, geom, supportedLayers) {

var engineEvents = {mouseover: "onmouseover", mouseout: "onmouseout", click: "onclick"};

return declare([Engine], {
	
	scaleFactor: 1.2,
	
	correctionScale: 10000,
	
	pointZoomFactor: 0.01,
	
	resizePoints: true,
	resizeLines: true,
	resizeAreas: true,
	
	correctScale: false,
	
	// array of layers
	layers: null,
	
	// registry of layers
	_layerReg: null,
	
	// container: Object
	//		Container for all map's divs
	container: null,
	
	constructor: function(kwArgs) {
		this._require = require;
		// set ignored dependencies
		lang.mixin(this.ignoredDependencies, {"Highlight": 1, "Tooltip": 1});
		this._supportedLayers = supportedLayers;
		// initialize basic factories
		this._initBasicFactories(new Placemark({
			map: this.map,
			engine: this
		}));
	},
	
	initialize: function(/* Function */readyFunction) {
		var map = this.map;
		this.map.container.style.overflow = "hidden";
		this.container = domConstruct.create("div", {style:{
			width: "100%",
			height: "100%",
			position: "relative"
		}}, map.container);
		this.surface = gfx.createSurface(this.container, map.width, map.height);
		this.surface.rawNode.style.position = "absolute";
		this.group = this.surface.createGroup();
		
		if (map.resizePoints !== undefined) this.resizePoints = map.resizePoints;
		if (map.resizeLines !== undefined) this.resizeLines = map.resizeLines;
		if (map.resizeAreas !== undefined) this.resizeAreas = map.resizeAreas;
		
		if (map.resizePoints !== undefined) this.resizePoints = map.resizePoints;
		if (map.resizeLines !== undefined) this.resizeLines = map.resizeLines;
		if (map.resizeAreas !== undefined) this.resizeAreas = map.resizeAreas;

		this.initialized = true;
		readyFunction();
	},
	
	createContainer: function(parentContainer, featureType) {
		// parentContainer is actually parent group
		return parentContainer.createGroup();
	},

	prepare: function() {
		var map = this.map,
			extent = map.getBbox()
		;
		if (extent) {
			this.extent = extent;
		}
		var mapWidth = extent[2] - extent[0],
			mapHeight = extent[3] - extent[1]
		;

		// check if we need to apply a corrective scaling
		if (mapWidth<1000 || mapHeight<1000) this.correctScale = true;

		this.factories.Placemark.init();
		this.factories.Placemark.prepare();
	},
	
	getTopContainer: function() {
		return this.group;
	},
	
	onForFeature: function(feature, event, method, context) {
		var connections = [];
		// normalize the callback function
		method = this.normalizeCallback(feature, event, method, context);
		event = engineEvents[event];
		array.forEach(feature.baseShapes, function(shape){
			connections.push([shape, shape.connect(event, method)]);
		});
		return connections;
	},
	
	disconnect: function(connections) {
		array.forEach(connections, function(connection){
			connection[0].disconnect(connection[1]);
		});
	},
	
	destroy: function() {
		this.surface.destroy();
	},
	
	onForMap: function(event, method, context) {
		// processing mouse events here

		return on(this.map.container, event, lang.hitch(this, function(e){
			// finding mouse position relative to the map container
			var containerPos = domGeom.position(this.container, true),
				x = e.pageX - containerPos.x,
				y = e.pageY - containerPos.y,
				// calling map's containerPixelToCoords instead of local one for the projection transformation to work
				coords = this.map.containerPixelToCoords(x, y)
			;
			method.call(context, {
				mapCoords: coords,
				nativeEvent: e
			});
		}));
	},
	
	_on_zoom_changed: function(event, method, context) {
		return on(this, event, lang.hitch(context, method));
	},

	_on_extent_changed: function(event, method, context) {
		return on(this, event, lang.hitch(context, method));
	},
	
	zoomTo: function(/* Array */extent) {
		// extent is array [x1,y1,x2,y2]
		var map = this.map,
			extentWidth = extent[2] - extent[0],
			extentHeight = extent[3] - extent[1],
			oldScale = (this.group.getTransform()||{xx:1}).xx,
			scale = Math.min(map.width/extentWidth, map.height/extentHeight),
			pf = this.factories.Placemark,
			x1 = pf.getX(extent[0]),
			y2 = pf.getY(extent[3])
		;
		
		if (extentWidth==0 && extentHeight==0) {
			// we've got a point
			var mapExtent = map.extent || map.getBbox(),
				mapWidth = mapExtent[2] - mapExtent[0],
				mapHeight = mapExtent[3] - mapExtent[1],
				extentSize = this.pointZoomFactor * Math.min(mapWidth, mapHeight);

			if (map.width > map.height) {
				extentHeight = extentSize;
				extentWidth = map.width/map.height*extentSize;
			}
			else {
				extentWidth = extentSize;
				extentHeight = map.height/map.width*extentSize;
			}

			scale = map.width/extentWidth; // equal to map.height/extentHeight
			x1 = pf.getX(extent[0] - extentWidth/2);
			y2 = pf.getY(extent[3] + extentHeight/2);
		}
		else if (extentWidth == 0) {
			// we've got a vertical line
			
		}
		else if (extentHeight == 0) {
			// we've got a horizontal line
		}
		else {
			
		}
		
		var layers = this.layers;
		if (layers.length) {
			array.forEach(layers, function(layer){
				layer.zoomTo(extent);
			});
			// check if we need to adjust scale if the bottom layer supports only discrete zooms
			if (layers[0].discreteScales) {
				scale = layers[0].getScale();
			}
		}

		// backup scale to perform the scale correction in the next line
		var _scale =  scale;
		if (this.correctScale) scale /= this.correctionScale;

		this.group.setTransform([
			matrix.translate( (map.width-_scale*extentWidth)/2, (map.height-_scale*extentHeight)/2 ),
			matrix.scale(scale),
			matrix.translate(-x1, -y2)
		]);
		
		if (oldScale != scale) {
			pf.calculateLengthDenominator();
			this.resizeFeatures(this.map.document, oldScale/scale);
		}
		
		this.onzoom_changed();
	},
	
	resizeFeatures: function(featureContainer, scaleFactor) {
		array.forEach(featureContainer.features, function(feature){
			if (feature.isPlacemark) this._resizePlacemark(feature, scaleFactor);
			else if (feature.isContainer) this.resizeFeatures(feature, scaleFactor);
		}, this);
	},
	
	_resizePlacemark: function(feature, scaleFactor) {
		if (feature.invalid) return;

		if (this.resizePoints && feature.isPoint()) {
			array.forEach(feature.baseShapes, function(shape){
				shape.applyRightTransform(matrix.scale(scaleFactor));
			});
		}
		else {
			if ( gfx.renderer!="vml" && !(gfx.renderer=="svg" && (has("webkit") || has("opera"))) && (
				(this.resizeLines && feature.isLine()) ||
				(this.resizeAreas && feature.isArea()) )) {
				array.forEach(feature.baseShapes, function(shape){
					var stroke = shape.getStroke();
					if (stroke) {
						stroke.width *= scaleFactor;
						shape.setStroke(stroke);
					}
				});
			}
		}
		
		if (feature.textShapes) {
			var factory = this.map.engine.factories.Placemark,
				transforms = factory._calculateTextPosition(feature)
			;

			array.forEach(feature.textShapes, function(t) {
				t.setTransform(transforms);
			});
		}
	},
	
	_setCamera: function(kwArgs) {
		var map = this.map,
			factory = map.engine.factories.Placemark,
			scale = djeo.scales[kwArgs.zoom],
			x = factory.getX(kwArgs.center[0] - map.width/scale/2),
			y = factory.getY(kwArgs.center[1] + map.height/scale/2),
			_scale =  scale
		;

		var layers = this.layers;
		if (layers.length) {
			array.forEach(layers, function(layer){
				layer._setCenterAndZoom(kwArgs.center, kwArgs.zoom);
			}, this);
		}

		if (this.correctScale) scale /= this.correctionScale;
		
		this.group.setTransform([
			matrix.scale(scale),
			matrix.translate(-x, -y)
		]);
		factory.calculateLengthDenominator();
		this.resizeFeatures(map.document, 1/scale);
	},

	_set_center: function(center) {
		center = this.map.getCoords(center);
		var map = this.map,
			factory = map.engine.factories.Placemark,
			scale = (this.group.getTransform()||{xx:1}).xx,
			_scale = scale
		;
		
		var layers = this.layers;
		if (layers.length) {
			array.forEach(layers, function(layer){
				layer.setCenter(center);
			}, this);
		}
		// performing a reverse action in comparison to zoomTo function
		if (this.correctScale) _scale *= this.correctionScale;
		var x = factory.getX(center[0] - map.width/_scale/2),
			y = factory.getY(center[1] + map.height/_scale/2)
		;
		this.group.setTransform([
			matrix.scale(scale),
			matrix.translate(-x, -y)
		]);
	},

	_get_center: function() {
		var map = this.map;
		return this.containerPixelToCoords(map.width/2, map.height/2);
	},
	
	_set_zoom: function(zoom) {
		var map = this.map;
		if (zoom < map.minZoom || zoom > map.maxZoom) return;

		var oldScale = (this.group.getTransform()||{xx:1}).xx,
			newScale = djeo.scales[zoom],
			scaleFactor = newScale/oldScale
		;
		var layers = this.layers;
		if (layers.length) {
			array.forEach(layers, function(layer){
				layer.setZoom(zoom);
			});
		}
		this.group.applyLeftTransform({xx:scaleFactor,yy:scaleFactor, dx: map.width/2*(1-scaleFactor), dy: map.height/2*(1-scaleFactor)});
		this.factories.Placemark.calculateLengthDenominator();
		this.resizeFeatures(this.map.document, 1/scaleFactor);

		this.onzoom_changed();
	},

	_get_zoom: function() {
		return this.layers.length ? this.layers[0].zoom : -1;
	},

	_get_extent: function() {
		var map = this.map,
			coords1 = this.containerPixelToCoords(0, map.height),
			coords2 = this.containerPixelToCoords(map.width, 0)
		;
		return [coords1[0], coords1[1], coords2[0], coords2[1]];
	},
	
	containerPixelToCoords: function(px, py) {
		var map = this.map,
			t = this.group.getTransform(),
			scale = t.xx, // same as t.yy
			x = -t.dx/scale,
			y = -t.dy/scale
		;
		// now getting coordinates in the map projection, i.e. performing a reverse action in comparison to zoomTo function
		if (this.correctScale) {
			x /= this.correctionScale;
			y /= this.correctionScale;
		}
		if (this.correctScale) scale *= this.correctionScale;
		x += this.extent[0] + px/scale;
		y = this.extent[3] - y - py/scale;
		return [x, y];
	},

	_appendDiv: function(div) {
		// we append the div to this.container
		this.container.children[0].appendChild(div);
	}
});

});