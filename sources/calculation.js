// 1.js

"use strict";

// Vertex shader program
const VSHADER_SOURCE =
	'attribute vec4 a_Position;\n' +
	'attribute float a_select;\n' +
	'uniform mat4 u_projMatrix;\n' +
	'uniform float u_pointSize;\n' +
	'uniform vec4 u_color;\n' +
	'uniform vec4 u_colorSelect;\n' +
	'varying vec4 v_color;\n' +
	'void main() {\n' +
	'  gl_Position = u_projMatrix * a_Position;\n' +
	'  gl_PointSize = u_pointSize;\n' +
	'  if (a_select != 0.0)\n' +
	'    v_color = u_colorSelect;\n' +
	'  else\n' +
	'    v_color = u_color;\n' +
	'}\n';

// Fragment shader program
const FSHADER_SOURCE =
	'precision mediump float;\n' +
	'varying vec4 v_color;\n' +
	'void main() {\n' +
	'  gl_FragColor = v_color;\n' +
	'}\n';

function main() {
	// Retrieve <canvas> element
	const canvas = document.getElementById('webgl');

	// Get the rendering context for WebGL
	const gl = getWebGLContext(canvas);
	if (!gl) {
		console.log('Failed to get the rendering context for WebGL');
		return;
	}

	// Initialize shaders
	if (!initShaders(gl, VSHADER_SOURCE, FSHADER_SOURCE)) {
		console.log('Failed to intialize shaders.');
		return;
	}

	gl.viewport(0, 0, canvas.width, canvas.height);

	const projMatrix = mat4.ortho(mat4.create(), 0, gl.drawingBufferWidth, 0, gl.drawingBufferHeight, 0, 1);

	// Pass the projection matrix to the vertex shader
	const u_projMatrix = gl.getUniformLocation(gl.program, 'u_projMatrix');
	if (!u_projMatrix) {
		console.log('Failed to get the storage location of u_projMatrix');
		return;
	}
	gl.uniformMatrix4fv(u_projMatrix, false, projMatrix);

	const countSplinePoints = document.getElementById("countSplinePoints");
	const splineOrder = document.getElementById("splineOrder");

	Data.init(gl, countSplinePoints, splineOrder);

	// Register function (event handler) to be called on a mouse press
	canvas.onclick = function (ev) { click(ev, canvas); };

	canvas.onmousemove = function (ev) { mousemove(ev, canvas); };

	canvas.onmousedown = function (ev) { mousedown(ev, canvas); };

	canvas.onmouseup = function (ev) { mouseup(ev, canvas); };

	const lineSpline = document.getElementById("chkLineSpline");
	const controlPolygon = document.getElementById("chkControlPolygon");
	const showControlPoints = document.getElementById("chkShowPoints");
	const visualizeSplineWithPoints = document.getElementById("chkVisualizeWithPoints");
	const visualizeSplineWithLines = document.getElementById("chkVisualizeWithLine");

	lineSpline.onclick = function () { Data.plotMode(1); };
	countSplinePoints.onchange = function () { Data.plotMode(2); };
	splineOrder.onchange = function () { Data.plotMode(2); };
	controlPolygon.onclick = function () { Data.plotMode(3); };
	visualizeSplineWithPoints.onclick = function () { Data.plotMode(4); };
	visualizeSplineWithLines.onclick = function () { Data.plotMode(5); };
	showControlPoints.onclick = function () { Data.plotMode(6); };

	// Specify the color for clearing <canvas>
	gl.clearColor(0.8, 0.8, 0.8, 1.0);

	// Clear <canvas>
	gl.clear(gl.COLOR_BUFFER_BIT);
}

class Point {
	constructor(x, y) {
		this.select = false;
		this.x = x;
		this.y = y;
		this.t = 0;
		this.setRect();
	}
	setPoint(x, y) {
		this.x = x;
		this.y = y;
		this.setRect();
	}
	setRect() {
		this.left = this.x - 5;
		this.right = this.x + 5;
		this.bottom = this.y - 5;
		this.up = this.y + 5;
	}
	ptInRect(x, y) {
		const inX = this.left <= x && x <= this.right;
		const inY = this.bottom <= y && y <= this.up;
		return inX && inY;
	}
}

function findSpan(n, k, t, knot_vector)
{
	if (Math.round(t * 1000000) == Math.round(knot_vector[n + 1] * 1000000))
		return n; /* Special case */
	/* Do binary search */
	let low = k;
	let high = n + 1;
	let mid = Math.floor((low + high) / 2);
	while ((t < knot_vector[mid]) || (t >= knot_vector[mid + 1]))
	{
		if (t < knot_vector[mid])
			high = mid;
		else
			low = mid;
		mid = Math.floor((low + high) / 2);
	}
	return mid;
}

function basisFuncs(i, t, k, knot_vector, N)
{
	let left = new Array(k + 1);
	let right = new Array(k + 1);
	let saved, temp;
	N[0] = 1.0;
	for (let j = 1; j <= k; j++)
	{
		left[j] = t - knot_vector[i + 1 - j];
		right[j] = knot_vector[i + j] - t;
		saved = 0.0;
		for (let r = 0; r < j; r++)
		{
			temp = N[r] / (right[r + 1] + left[j - r]);
			N[r] = saved + right[r + 1] * temp;
			saved = left[j - r] * temp;
		}
		N[j] = saved;
	}
	return (N);
}

const Data = {
	pointsCtr: [],
	pointsSpline: [],
	countAttribData: 3, //x,y,sel
	verticesCtr: {},
	verticesSpline: {},
	FSIZE: 0,
	gl: null,
	vertexBufferCtr: null,
	vertexBufferSpline: null,
	a_Position: -1,
	a_select: -1,
	u_color: null,
	u_colorSelect: null,
	u_pointSize: null,
	movePoint: false,
	iMove: -1,
	leftButtonDown: false,
	drawControlPolygon: false,
	drawLineSpline: false,
	showControlPoints: true,
	visualizeSplineWithPoints: true,
	visualizeSplineWithLine: false,
	countSplinePoints: null,
	splineOrder: null,
	init: function (gl, countSplinePoints, splineOrder) {
		this.gl = gl;
		// Create a buffer object
		this.vertexBufferCtr = this.gl.createBuffer();
		if (!this.vertexBufferCtr) {
			console.log('Failed to create the buffer object for control points');
			return -1;
		}
		this.vertexBufferSpline = this.gl.createBuffer();
		if (!this.vertexBufferSpline) {
			console.log('Failed to create the buffer object for spline points');
			return -1;
		}

		this.a_Position = this.gl.getAttribLocation(this.gl.program, 'a_Position');
		if (this.a_Position < 0) {
			console.log('Failed to get the storage location of a_Position');
			return -1;
		}

		this.a_select = this.gl.getAttribLocation(this.gl.program, 'a_select');
		if (this.a_select < 0) {
			console.log('Failed to get the storage location of a_select');
			return -1;
		}

		// Get the storage location of u_color
		this.u_color = this.gl.getUniformLocation(this.gl.program, 'u_color');
		if (!this.u_color) {
			console.log('Failed to get u_color variable');
			return;
		}

		// Get the storage location of u_colorSelect
		this.u_colorSelect = gl.getUniformLocation(this.gl.program, 'u_colorSelect');
		if (!this.u_colorSelect) {
			console.log('Failed to get u_colorSelect variable');
			return;
		}

		// Get the storage location of u_pointSize
		this.u_pointSize = gl.getUniformLocation(this.gl.program, 'u_pointSize');
		if (!this.u_pointSize) {
			console.log('Failed to get u_pointSize variable');
			return;
		}

		this.countSplinePoints = countSplinePoints;
		this.splineOrder = splineOrder;
	},
	setLeftButtonDown: function (value) {
		this.leftButtonDown = value;
	},
	add_coords: function (x, y) {
		const pt = new Point(x, y);
		this.pointsCtr.push(pt);
		this.add_vertices();
	},
	mousemoveHandler: function (x, y) {
		if (this.leftButtonDown) {
			if (this.movePoint) {
				this.pointsCtr[this.iMove].setPoint(x, y);

				this.verticesCtr[this.iMove * this.countAttribData] = this.pointsCtr[this.iMove].x;
				this.verticesCtr[this.iMove * this.countAttribData + 1] = this.pointsCtr[this.iMove].y;

				this.setVertexBuffersAndDraw();

				if (this.drawLineSplines)
					this.calculateLineSpline();
			}
		}
		else
			for (let i = 0; i < this.pointsCtr.length; i++) {
				this.pointsCtr[i].select = false;

				if (this.pointsCtr[i].ptInRect(x, y))
					this.pointsCtr[i].select = true;

				this.verticesCtr[i * this.countAttribData + 2] = this.pointsCtr[i].select;

				this.setVertexBuffersAndDraw();
			}
	},
	mousedownHandler: function (button, x, y) {

		if (button == 0) { //left button
			this.movePoint = false;

			for (let i = 0; i < this.pointsCtr.length; i++) {
				if (this.pointsCtr[i].select == true) {
					this.movePoint = true;
					this.iMove = i;
				}
			}

			this.setLeftButtonDown(true);
		}



	},
	mouseupHandler: function (button, x, y) {
		if (button == 0) //left button
			this.setLeftButtonDown(false);
	},
	clickHandler: function (x, y) {
		if (!this.movePoint) {
			this.add_coords(x, y);
			if (this.drawLineSplines)
				this.calculateLineSpline();
			this.setVertexBuffersAndDraw();
		}
	},
	add_vertices: function () {
		this.verticesCtr = new Float32Array(this.pointsCtr.length * this.countAttribData);
		for (let i = 0; i < this.pointsCtr.length; i++) {
			this.verticesCtr[i * this.countAttribData] = this.pointsCtr[i].x;
			this.verticesCtr[i * this.countAttribData + 1] = this.pointsCtr[i].y;
			this.verticesCtr[i * this.countAttribData + 2] = this.pointsCtr[i].select;
		}
		this.FSIZE = this.verticesCtr.BYTES_PER_ELEMENT;
	},
	setVertexBuffersAndDraw: function () {
		if (this.pointsCtr.length == 0)
			return;

		// Bind the buffer object to target
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBufferCtr);
		// Write date into the buffer object
		this.gl.bufferData(this.gl.ARRAY_BUFFER, this.verticesCtr, this.gl.DYNAMIC_DRAW);
		// Assign the buffer object to a_Position variable
		this.gl.vertexAttribPointer(this.a_Position, 2, this.gl.FLOAT, false, this.FSIZE * 3, 0);
		// Enable the assignment to a_Position variable
		this.gl.enableVertexAttribArray(this.a_Position);
		// Assign the buffer object to a_select variable
		this.gl.vertexAttribPointer(this.a_select, 1, this.gl.FLOAT, false, this.FSIZE * 3, this.FSIZE * 2);
		// Enable the assignment to a_select variable
		this.gl.enableVertexAttribArray(this.a_select);

		// Clear <canvas>
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);
		this.gl.uniform4f(this.u_color, 0.0, 0.0, 0.0, 1.0);
		this.gl.uniform4f(this.u_colorSelect, 0.5, 0.5, 0.0, 1.0);
		this.gl.uniform1f(this.u_pointSize, 10.0);
		// Draw
		if (this.showControlPoints)
			this.gl.drawArrays(this.gl.POINTS, 0, this.pointsCtr.length);
		if (this.drawControlPolygon) {
			this.gl.uniform4f(this.u_color, 0.0, 0.0, 0.0, 1.0);
			this.gl.uniform4f(this.u_colorSelect, 0.0, 0.0, 0.0, 1.0);

			this.gl.drawArrays(this.gl.LINE_STRIP, 0, this.pointsCtr.length);
		}
		if (this.drawLineSplines) {
			// Bind the buffer object to target
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBufferSpline);
			// Write date into the buffer object
			this.gl.bufferData(this.gl.ARRAY_BUFFER, this.verticesSpline, this.gl.DYNAMIC_DRAW);
			// Assign the buffer object to a_Position variable
			this.gl.vertexAttribPointer(this.a_Position, 2, this.gl.FLOAT, false, 0, 0);
			// Enable the assignment to a_Position variable
			this.gl.enableVertexAttribArray(this.a_Position);
			// Disable the assignment to a_select variable
			this.gl.disableVertexAttribArray(this.a_select);

			this.gl.uniform4f(this.u_color, 1.0, 0.0, 0.0, 1.0);
			this.gl.uniform1f(this.u_pointSize, 7.0);

			if (this.visualizeSplineWithPoints)
				this.gl.drawArrays(this.gl.POINTS, 0, this.pointsSpline.length);

			if (this.visualizeSplineWithLine)
				this.gl.drawArrays(this.gl.LINE_STRIP, 0, this.pointsSpline.length);
		}
	},
	plotMode: function (selOption) {
		switch (selOption) {
			case 1:
				this.drawLineSplines = !this.drawLineSplines;
				if (this.drawLineSplines)
					this.calculateLineSpline();
				break;
			case 2:
				if (this.drawLineSplines)
					this.calculateLineSpline();
				break;
			case 3:
				this.drawControlPolygon = !this.drawControlPolygon;
				break;
			case 4:
				this.visualizeSplineWithPoints = !this.visualizeSplineWithPoints;
				break;
			case 5:
				this.visualizeSplineWithLine = !this.visualizeSplineWithLine;
				break;
			case 6:
				this.showControlPoints = !this.showControlPoints;
				break;
		}
		this.setVertexBuffersAndDraw();
	},
	calculateLineSpline: function () {
		let span, i, j;
		let pt;
		let t, dt;
		let d = 0;
		const p = Number(this.splineOrder.value);

		if (p >= this.pointsCtr.length)
			return ;

		// calculating the knot vector
		let knot_vector = new Array(this.pointsCtr.length + p + 1);
		for (i = 0; i <= p; ++i)
			knot_vector[i] = 0;
		for (i = p + 1; i <= this.pointsCtr.length - 1; ++i)
			knot_vector[i] = i - p;
		for (i = this.pointsCtr.length; i <= this.pointsCtr.length + p; ++i)
			knot_vector[i] = this.pointsCtr.length - p;
		let t_max = this.pointsCtr.length - p;

		const N = Number(this.countSplinePoints.value);
		this.pointsSpline = new Array(N);

		// calculating the values of a parametric function in points
		if (this.pointsCtr.length > 1)
		{
			dt = (t_max - this.pointsCtr[0].t) / (N - 1);
			t = this.pointsCtr[0].t;
			for (i = 0; i < N; i++)
			{
				let x = 0, y = 0;
				let basis_func = new Array(p + 1);
				span = findSpan(this.pointsCtr.length - 1, p, t, knot_vector);
				basisFuncs(span, t, p, knot_vector, basis_func);		
				for (let l = 0; l < p + 1; l++)
				{
						x += basis_func[l] * this.pointsCtr[span - p + l].x;
						y += basis_func[l] * this.pointsCtr[span - p + l].y;
				}
				pt = new Point(x, y);
				this.pointsSpline[i] = pt;
				t += dt;
			}
		}

		// filling in an array for rendering
		this.verticesSpline = new Float32Array(this.pointsSpline.length * 2);
		for (i = 0; i < this.pointsSpline.length; i++) {
			this.verticesSpline[i * 2] = this.pointsSpline[i].x;
			this.verticesSpline[i * 2 + 1] = this.pointsSpline[i].y;
		}
	}
}

function click(ev, canvas) {
	const x = ev.clientX; // x coordinate of a mouse pointer
	const y = ev.clientY; // y coordinate of a mouse pointer
	const rect = ev.target.getBoundingClientRect();

	Data.clickHandler(x - rect.left, canvas.height - (y - rect.top));
}

function mousedown(ev, canvas) {
	const x = ev.clientX; // x coordinate of a mouse pointer
	const y = ev.clientY; // y coordinate of a mouse pointer
	const rect = ev.target.getBoundingClientRect();

	Data.mousedownHandler(EventUtil.getButton(ev), x - rect.left, canvas.height - (y - rect.top));
}

function mouseup(ev, canvas) {
	const x = ev.clientX; // x coordinate of a mouse pointer
	const y = ev.clientY; // y coordinate of a mouse pointer
	const rect = ev.target.getBoundingClientRect();

	Data.mouseupHandler(EventUtil.getButton(ev), x - rect.left, canvas.height - (y - rect.top));
}

function mousemove(ev, canvas) {
	const x = ev.clientX; // x coordinate of a mouse pointer
	const y = ev.clientY; // y coordinate of a mouse pointer
	const rect = ev.target.getBoundingClientRect();
	// if (ev.buttons == 1)
	// 	alert('with left key');
	Data.mousemoveHandler(x - rect.left, canvas.height - (y - rect.top));
}
