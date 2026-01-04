/**
 * InkCanvas Enhanced Renderer
 * 增强型书写控件渲染器，支持压力感应、图层管理、笔触优化等功能
 */

class InkCanvasRenderer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    
    this.layers = [];
    this.currentLayerIndex = 0;
    this.activeLayer = null;
    
    this.strokes = [];
    this.currentStroke = null;
    
    this.isDrawing = false;
    this.lastPoint = null;
    
    this.brushSize = 4;
    this.brushColor = '#000000';
    this.pressureEnabled = true;
    this.pressureFactor = 0.5;
    
    this.eraserSize = 20;
    this.eraserMode = 'pixel';
    this.isErasing = false;
    
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = 30;
    
    this.devicePixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    
    this.init();
  }

  init() {
    this.resizeCanvas();
    this.createNewLayer();
    this.setupEventListeners();
    this.saveHistory();
    
    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.redrawAll();
    });
    
    this.publishReady();
  }

  resizeCanvas() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.canvas.width = Math.floor(width * this.devicePixelRatio);
    this.canvas.height = Math.floor(height * this.devicePixelRatio);
    
    this.ctx.scale(this.devicePixelRatio, this.devicePixelRatio);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  createNewLayer() {
    const layer = {
      id: Date.now(),
      name: `图层 ${this.layers.length + 1}`,
      visible: true,
      opacity: 1,
      strokes: [],
      canvas: document.createElement('canvas'),
      ctx: null
    };
    
    layer.canvas.width = this.canvas.width;
    layer.canvas.height = this.canvas.height;
    layer.ctx = layer.canvas.getContext('2d');
    layer.ctx.scale(this.devicePixelRatio, this.devicePixelRatio);
    layer.ctx.lineCap = 'round';
    layer.ctx.lineJoin = 'round';
    
    this.layers.push(layer);
    this.currentLayerIndex = this.layers.length - 1;
    this.activeLayer = layer;
    
    this.publishLayerChanged();
    return layer;
  }

  setupEventListeners() {
    this.canvas.addEventListener('pointerdown', this.handlePointerDown.bind(this));
    this.canvas.addEventListener('pointermove', this.handlePointerMove.bind(this));
    this.canvas.addEventListener('pointerup', this.handlePointerUp.bind(this));
    this.canvas.addEventListener('pointerleave', this.handlePointerUp.bind(this));
  }

  getCanvasPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure || 0.5
    };
  }

  handlePointerDown(e) {
    e.preventDefault();
    this.isDrawing = true;
    const point = this.getCanvasPoint(e);
    this.lastPoint = point;
    
    if (this.isErasing) {
      this.handleEraserDown(point);
    } else {
      this.handlePenDown(point);
    }
  }

  handlePointerMove(e) {
    if (!this.isDrawing) return;
    e.preventDefault();
    
    const point = this.getCanvasPoint(e);
    
    if (this.isErasing) {
      this.handleEraserMove(point);
    } else {
      this.handlePenMove(point);
    }
    
    this.lastPoint = point;
  }

  handlePointerUp(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    
    if (this.currentStroke) {
      this.activeLayer.strokes.push(this.currentStroke);
      this.publishStrokeAdded(this.currentStroke);
      this.currentStroke = null;
    }
    
    this.saveHistory();
  }

  handlePenDown(point) {
    const size = this.pressureEnabled 
      ? this.brushSize * (0.5 + point.pressure * this.pressureFactor)
      : this.brushSize;
    
    this.currentStroke = {
      type: 'stroke',
      color: this.brushColor,
      baseSize: this.brushSize,
      points: [{
        x: point.x,
        y: point.y,
        pressure: point.pressure,
        size: size
      }]
    };
    
    this.drawPoint(this.activeLayer.ctx, point.x, point.y, size, this.brushColor);
  }

  handlePenMove(point) {
    if (!this.currentStroke) return;
    
    const size = this.pressureEnabled 
      ? this.brushSize * (0.5 + point.pressure * this.pressureFactor)
      : this.brushSize;
    
    this.currentStroke.points.push({
      x: point.x,
      y: point.y,
      pressure: point.pressure,
      size: size
    });
    
    this.drawSmoothStroke(
      this.activeLayer.ctx,
      this.lastPoint,
      point,
      this.brushColor,
      size
    );
  }

  handleEraserDown(point) {
    if (this.eraserMode === 'pixel') {
      this.erasePixel(point);
    } else if (this.eraserMode === 'stroke') {
      this.eraseStrokeAtPoint(point);
    } else if (this.eraserMode === 'rect') {
      this.startRectErase(point);
    }
  }

  handleEraserMove(point) {
    if (this.eraserMode === 'pixel') {
      this.erasePixel(point);
    } else if (this.eraserMode === 'stroke') {
      this.eraseStrokeAtPoint(point);
    } else if (this.eraserMode === 'rect') {
      this.updateRectErase(point);
    }
  }

  drawPoint(ctx, x, y, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawSmoothStroke(ctx, p1, p2, color, size) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
    ctx.lineTo(p2.x, p2.y);
    
    ctx.stroke();
    ctx.restore();
  }

  erasePixel(point) {
    const ctx = this.activeLayer.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(point.x, point.y, this.eraserSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.redrawAll();
  }

  eraseStrokeAtPoint(point) {
    const threshold = this.eraserSize;
    const strokesToRemove = [];
    
    for (let i = this.activeLayer.strokes.length - 1; i >= 0; i--) {
      const stroke = this.activeLayer.strokes[i];
      if (this.isPointNearStroke(point, stroke, threshold)) {
        strokesToRemove.push(i);
      }
    }
    
    for (const index of strokesToRemove) {
      this.activeLayer.strokes.splice(index, 1);
    }
    
    if (strokesToRemove.length > 0) {
      this.redrawLayer(this.activeLayer);
      this.saveHistory();
    }
  }

  isPointNearStroke(point, stroke, threshold) {
    for (const p of stroke.points) {
      const dx = p.x - point.x;
      const dy = p.y - point.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= threshold) {
        return true;
      }
    }
    return false;
  }

  startRectErase(point) {
    this.rectEraseStart = point;
    this.rectEraseEnd = point;
  }

  updateRectErase(point) {
    this.rectEraseEnd = point;
    this.redrawAll();
    this.drawRectErasePreview();
  }

  drawRectErasePreview() {
    if (!this.rectEraseStart || !this.rectEraseEnd) return;
    
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.min(this.rectEraseStart.x, this.rectEraseEnd.x),
      Math.min(this.rectEraseStart.y, this.rectEraseEnd.y),
      Math.abs(this.rectEraseEnd.x - this.rectEraseStart.x),
      Math.abs(this.rectEraseEnd.y - this.rectEraseStart.y)
    );
    ctx.restore();
  }

  redrawAll() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    for (const layer of this.layers) {
      if (layer.visible) {
        this.ctx.save();
        this.ctx.globalAlpha = layer.opacity;
        this.ctx.drawImage(layer.canvas, 0, 0);
        this.ctx.restore();
      }
    }
  }

  redrawLayer(layer) {
    layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    
    for (const stroke of layer.strokes) {
      this.redrawStroke(layer.ctx, stroke);
    }
    
    this.redrawAll();
  }

  redrawStroke(ctx, stroke) {
    if (stroke.points.length === 0) return;
    
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      ctx.fillStyle = stroke.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const p0 = stroke.points[i - 1];
        const p1 = stroke.points[i];
        const p2 = stroke.points[i + 1];
        const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        ctx.lineWidth = p1.size;
        ctx.beginPath();
        ctx.moveTo(mid1.x, mid1.y);
        ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
        ctx.stroke();
      }
      
      const last = stroke.points[stroke.points.length - 1];
      const secondLast = stroke.points[stroke.points.length - 2];
      const mid = { x: (secondLast.x + last.x) / 2, y: (secondLast.y + last.y) / 2 };
      ctx.lineWidth = last.size;
      ctx.beginPath();
      ctx.moveTo(mid.x, mid.y);
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
    
    ctx.restore();
  }

  saveHistory() {
    const snapshot = this.createSnapshot();
    
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }
    
    this.history.push(snapshot);
    this.historyIndex = this.history.length - 1;
    
    if (this.history.length > this.maxHistory) {
      this.history.shift();
      this.historyIndex--;
    }
  }

  createSnapshot() {
    return {
      layers: this.layers.map(layer => ({
        ...layer,
        strokes: JSON.parse(JSON.stringify(layer.strokes))
      })),
      currentLayerIndex: this.currentLayerIndex
    };
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    this.restoreSnapshot(this.history[this.historyIndex]);
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    this.restoreSnapshot(this.history[this.historyIndex]);
  }

  restoreSnapshot(snapshot) {
    this.layers = snapshot.layers.map(layer => {
      const newLayer = {
        ...layer,
        canvas: document.createElement('canvas'),
        ctx: null
      };
      newLayer.canvas.width = this.canvas.width;
      newLayer.canvas.height = this.canvas.height;
      newLayer.ctx = newLayer.canvas.getContext('2d');
      newLayer.ctx.scale(this.devicePixelRatio, this.devicePixelRatio);
      newLayer.ctx.lineCap = 'round';
      newLayer.ctx.lineJoin = 'round';
      return newLayer;
    });
    
    this.currentLayerIndex = snapshot.currentLayerIndex;
    this.activeLayer = this.layers[this.currentLayerIndex];
    
    for (const layer of this.layers) {
      this.redrawLayer(layer);
    }
    
    this.redrawAll();
  }

  setBrushSize(size) {
    this.brushSize = size;
  }

  setBrushColor(color) {
    this.brushColor = color;
  }

  setPressureEnabled(enabled) {
    this.pressureEnabled = enabled;
  }

  setPressureFactor(factor) {
    this.pressureFactor = factor;
  }

  setEraserSize(size) {
    this.eraserSize = size;
  }

  setEraserMode(mode) {
    this.eraserMode = mode;
  }

  setErasing(erasing) {
    this.isErasing = erasing;
  }

  switchLayer(index) {
    if (index >= 0 && index < this.layers.length) {
      this.currentLayerIndex = index;
      this.activeLayer = this.layers[index];
      this.publishLayerChanged();
    }
  }

  deleteLayer(index) {
    if (this.layers.length <= 1) return;
    if (index >= 0 && index < this.layers.length) {
      this.layers.splice(index, 1);
      if (this.currentLayerIndex >= this.layers.length) {
        this.currentLayerIndex = this.layers.length - 1;
      }
      this.activeLayer = this.layers[this.currentLayerIndex];
      this.redrawAll();
      this.saveHistory();
      this.publishLayerChanged();
    }
  }

  clearLayer(index) {
    if (index >= 0 && index < this.layers.length) {
      this.layers[index].strokes = [];
      this.redrawLayer(this.layers[index]);
      this.redrawAll();
      this.saveHistory();
    }
  }

  setLayerVisibility(index, visible) {
    if (index >= 0 && index < this.layers.length) {
      this.layers[index].visible = visible;
      this.redrawAll();
    }
  }

  setLayerOpacity(index, opacity) {
    if (index >= 0 && index < this.layers.length) {
      this.layers[index].opacity = opacity;
      this.redrawAll();
    }
  }

  publishReady() {
    if (typeof Mod !== 'undefined' && Mod.publish) {
      Mod.publish('public/inkcanvas-ready', {
        version: '1.0.0',
        features: ['pressure', 'layers', 'eraser']
      });
    }
  }

  publishStrokeAdded(stroke) {
    if (typeof Mod !== 'undefined' && Mod.publish) {
      Mod.publish('public/stroke-added', {
        stroke: stroke,
        layerIndex: this.currentLayerIndex
      });
    }
  }

  publishLayerChanged() {
    if (typeof Mod !== 'undefined' && Mod.publish) {
      Mod.publish('public/layer-changed', {
        currentLayer: this.currentLayerIndex,
        totalLayers: this.layers.length,
        layerName: this.activeLayer ? this.activeLayer.name : ''
      });
    }
  }

  getStats() {
    let totalStrokes = 0;
    for (const layer of this.layers) {
      totalStrokes += layer.strokes.length;
    }
    return {
      totalLayers: this.layers.length,
      totalStrokes: totalStrokes,
      currentLayer: this.currentLayerIndex
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = InkCanvasRenderer;
}
