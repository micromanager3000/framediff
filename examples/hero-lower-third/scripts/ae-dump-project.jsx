// Dump the open After Effects project to JSON for FrameDiff reconstruction.
// Run from AppleScript:
//   tell application "Adobe After Effects 2026" to DoScriptFile POSIX file ".../ae-dump-project.jsx"

(function () {
  var OUT = "/path/to/framediff/examples/hero-lower-third/ae/aep-dump.json";

  function esc(s) {
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t");
  }

  function json(v) {
    if (v === null || v === undefined) return "null";
    var t = typeof v;
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") return '"' + esc(v) + '"';
    if (v instanceof Array) {
      var a = [];
      for (var i = 0; i < v.length; i++) a.push(json(v[i]));
      return "[" + a.join(",") + "]";
    }
    var parts = [];
    for (var k in v) if (v.hasOwnProperty(k)) parts.push(json(k) + ":" + json(v[k]));
    return "{" + parts.join(",") + "}";
  }

  function safe(fn, fallback) {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  }

  function val(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
    if (v instanceof Array) {
      var out = [];
      for (var i = 0; i < v.length; i++) out.push(val(v[i]));
      return out;
    }
    return String(v);
  }

  function dumpProperty(p, depth) {
    var o = {
      name: safe(function () { return p.name; }, ""),
      matchName: safe(function () { return p.matchName; }, ""),
      propertyType: safe(function () { return p.propertyType; }, null),
      enabled: safe(function () { return p.enabled; }, null),
      active: safe(function () { return p.active; }, null),
    };

    var canValue = safe(function () { return p.propertyValueType !== undefined; }, false);
    if (canValue) {
      o.propertyValueType = safe(function () { return p.propertyValueType; }, null);
      o.expression = safe(function () { return p.expression; }, "");
      o.expressionEnabled = safe(function () { return p.expressionEnabled; }, false);
      o.numKeys = safe(function () { return p.numKeys; }, 0);
      if (o.numKeys && o.numKeys > 0) {
        o.keys = [];
        for (var k = 1; k <= o.numKeys; k++) {
          o.keys.push({
            time: safe(function () { return p.keyTime(k); }, null),
            value: safe(function () { return val(p.keyValue(k)); }, null),
            inInterpolation: safe(function () { return String(p.keyInInterpolationType(k)); }, null),
            outInterpolation: safe(function () { return String(p.keyOutInterpolationType(k)); }, null),
          });
        }
      } else {
        o.value = safe(function () { return val(p.value); }, null);
      }
    }

    var n = safe(function () { return p.numProperties; }, 0);
    if (n && depth < 8) {
      o.properties = [];
      for (var i = 1; i <= n; i++) o.properties.push(dumpProperty(p.property(i), depth + 1));
    }
    return o;
  }

  function dumpLayer(layer) {
    var source = safe(function () { return layer.source; }, null);
    var sourceFile = source ? safe(function () { return source.file ? source.file.fsName : null; }, null) : null;
    var sourceName = source ? safe(function () { return source.name; }, null) : null;
    var o = {
      index: layer.index,
      name: safe(function () { return layer.name; }, ""),
      matchName: safe(function () { return layer.matchName; }, ""),
      enabled: safe(function () { return layer.enabled; }, null),
      shy: safe(function () { return layer.shy; }, null),
      solo: safe(function () { return layer.solo; }, null),
      locked: safe(function () { return layer.locked; }, null),
      hasVideo: safe(function () { return layer.hasVideo; }, null),
      hasAudio: safe(function () { return layer.hasAudio; }, null),
      threeDLayer: safe(function () { return layer.threeDLayer; }, null),
      adjustmentLayer: safe(function () { return layer.adjustmentLayer; }, null),
      nullLayer: safe(function () { return layer.nullLayer; }, null),
      guideLayer: safe(function () { return layer.guideLayer; }, null),
      startTime: safe(function () { return layer.startTime; }, null),
      inPoint: safe(function () { return layer.inPoint; }, null),
      outPoint: safe(function () { return layer.outPoint; }, null),
      stretch: safe(function () { return layer.stretch; }, null),
      blendingMode: safe(function () { return String(layer.blendingMode); }, null),
      trackMatteType: safe(function () { return String(layer.trackMatteType); }, null),
      parentIndex: safe(function () { return layer.parent ? layer.parent.index : null; }, null),
      sourceName: sourceName,
      sourceFile: sourceFile,
      sourceMainSource: source ? safe(function () { return source.mainSource ? String(source.mainSource) : null; }, null) : null,
    };

    var props = [];
    var names = [
      "ADBE Transform Group",
      "ADBE Effect Parade",
      "ADBE Text Properties",
      "ADBE Camera Options Group",
      "ADBE Light Options Group",
      "ADBE Mask Parade",
      "ADBE Time Remapping",
    ];
    for (var i = 0; i < names.length; i++) {
      var p = safe(function () { return layer.property(names[i]); }, null);
      if (p) props.push(dumpProperty(p, 0));
    }
    o.properties = props;
    return o;
  }

  function dumpItem(item) {
    var kind = safe(function () { return item.typeName; }, "");
    var o = {
      id: safe(function () { return item.id; }, null),
      index: safe(function () { return item.index; }, null),
      name: safe(function () { return item.name; }, ""),
      typeName: kind,
    };
    if (item instanceof CompItem) {
      o.width = item.width;
      o.height = item.height;
      o.pixelAspect = item.pixelAspect;
      o.duration = item.duration;
      o.frameRate = item.frameRate;
      o.frameDuration = item.frameDuration;
      o.displayStartTime = item.displayStartTime;
      o.numLayers = item.numLayers;
      o.layers = [];
      for (var l = 1; l <= item.numLayers; l++) o.layers.push(dumpLayer(item.layer(l)));
    } else if (item instanceof FootageItem) {
      o.width = safe(function () { return item.width; }, null);
      o.height = safe(function () { return item.height; }, null);
      o.duration = safe(function () { return item.duration; }, null);
      o.frameRate = safe(function () { return item.frameRate; }, null);
      o.file = safe(function () { return item.file ? item.file.fsName : null; }, null);
      o.mainSource = safe(function () { return item.mainSource ? String(item.mainSource) : null; }, null);
    } else if (item instanceof FolderItem) {
      o.numItems = item.numItems;
    }
    return o;
  }

  var project = app.project;
  var dump = {
    projectFile: safe(function () { return project.file ? project.file.fsName : null; }, null),
    numItems: project.numItems,
    bitsPerChannel: project.bitsPerChannel,
    timeDisplayType: String(project.timeDisplayType),
    items: [],
  };

  for (var i = 1; i <= project.numItems; i++) dump.items.push(dumpItem(project.item(i)));

  var f = new File(OUT);
  f.encoding = "UTF-8";
  f.open("w");
  f.write(json(dump));
  f.close();
})();
