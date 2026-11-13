/* The Cosmic Universe: a real 3D scene (Three.js) with stars at many depths, a nebula, a galaxy, planets, a black hole and shooting stars.
   It only draws into its own canvas behind the interface and never receives clicks. */
(function (CC) {
  'use strict';
  const NOISE = 'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}' +
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);}' +
    'float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<OCT;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=0.5;}return v;}';
  const UV_VERT = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';
  const rand = (a, b) => a + Math.random() * (b - a), gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

  CC.cosmos = function (canvas, mobile, getParallax) {
    const T = window.THREE, OCT = '#define OCT ' + (mobile ? 4 : 5) + '\n';
    const renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: mobile ? 'low-power' : 'high-performance' });
    renderer.setClearColor(0x05040c, 1);
    let pr = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5), W = 1, H = 1, halfTan = Math.tan(55 * Math.PI / 360);
    const scene = new T.Scene(), cam = new T.PerspectiveCamera(55, 1, 1, 7000), uTime = { value: 0 }, uPx = { value: 1 };
    const place = (o, nx, ny, z) => { const hh = halfTan * z; o.position.set(nx * hh * (W / H), ny * hh, -z); };

    // ---- stars, dust and the galaxy share one point shader ----
    const pointMat = (boost) => new T.ShaderMaterial({
      uniforms: { uTime, uPx, uBoost: { value: boost } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: 'attribute float aSize;attribute float aPhase;attribute vec3 aColor;uniform float uTime;uniform float uPx;varying vec3 vC;varying float vTw;void main(){vC=aColor;vTw=0.55+0.45*sin(uTime*(0.5+fract(aPhase*7.31)*1.9)+aPhase*6.283);vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=max(1.0,aSize*uPx*(2600.0/-mv.z));gl_Position=projectionMatrix*mv;}',
      fragmentShader: 'varying vec3 vC;varying float vTw;uniform float uBoost;void main(){float r=length(gl_PointCoord-0.5);float a=smoothstep(0.5,0.0,r);a*=a;gl_FragColor=vec4(vC*vTw*uBoost,a*vTw);}'
    });
    const points = (n, gen, boost, order) => {
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), ph = new Float32Array(n);
      for (let i = 0; i < n; i++) { const s = gen(i); pos.set(s.p, i * 3); col.set(s.c, i * 3); size[i] = s.s; ph[i] = Math.random(); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aColor', new T.BufferAttribute(col, 3)); g.setAttribute('aSize', new T.BufferAttribute(size, 1)); g.setAttribute('aPhase', new T.BufferAttribute(ph, 1));
      const m = new T.Points(g, pointMat(boost)); m.frustumCulled = false; m.renderOrder = order; return m;
    };
    const TINTS = [[1, 1, 1], [.78, .84, 1], [1, .86, .66], [.82, .72, 1], [1, .95, .86]];
    const sphere = (r0, r1) => { const u = rand(-1, 1), a = rand(0, 6.2832), s = Math.sqrt(1 - u * u), r = rand(r0, r1); return [s * Math.cos(a) * r, u * r, s * Math.sin(a) * r]; };
    const starN = mobile ? 2600 : 6500;
    const stars = points(starN, () => { const b = Math.pow(Math.random(), 6); return { p: sphere(1000, 2600), c: TINTS[Math.floor(Math.random() * TINTS.length)].map((v) => v * (.55 + b * .9)), s: 1.1 + b * 5.5 + Math.random() * .8 }; }, 1, 1);
    scene.add(stars);
    const dust = points(mobile ? 120 : 260, () => ({ p: [rand(-420, 420), rand(-260, 260), rand(-420, -60)], c: Math.random() < .5 ? [.5, .36, .9] : [.9, .6, .3], s: rand(1.2, 3) }), .16, 4);
    scene.add(dust);
    const galaxy = points(mobile ? 900 : 1800, (i) => { const t = Math.pow(Math.random(), .65), r = t * 130, a = (i % 3) * 2.094 + r * .034 + gauss() * .4; return { p: [Math.cos(a) * r, gauss() * 5 * (1 - t), Math.sin(a) * r], c: t < .2 ? [1, .86, .62] : Math.random() < .5 ? [.66, .56, 1] : [.5, .66, 1], s: t < .15 ? 3.4 : rand(1, 2.4) }; }, .8, 1);
    const galaxyG = new T.Group(); galaxyG.add(galaxy); galaxyG.rotation.set(1.05, 0, .45); scene.add(galaxyG);

    // ---- nebula: animated clouds on a far backdrop ----
    const nebula = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShaderMaterial({
      uniforms: { uTime }, transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending, vertexShader: UV_VERT,
      fragmentShader: OCT + 'varying vec2 vUv;uniform float uTime;' + NOISE + 'void main(){vec2 p=vUv*vec2(5.5,3.6);float t=uTime*0.012;float n=fbm(p+vec2(t,-t*0.6)+fbm(p*0.7-t)*1.25);float m=smoothstep(0.4,0.86,n);vec3 purple=vec3(0.36,0.15,0.66),navy=vec3(0.05,0.09,0.36),amber=vec3(0.9,0.5,0.16);vec3 c=mix(navy,purple,smoothstep(0.3,0.75,fbm(p*0.5+3.0)));c+=amber*0.32*smoothstep(0.66,0.92,fbm(p*0.9-vec2(4.0,1.0)+t));float e=smoothstep(0.0,0.2,vUv.x)*smoothstep(1.0,0.8,vUv.x)*smoothstep(0.0,0.2,vUv.y)*smoothstep(1.0,0.8,vUv.y);gl_FragColor=vec4(c*m*0.8*e,1.0);}'
    }));
    nebula.renderOrder = 0; scene.add(nebula);

    // ---- planets ----
    const PLANET_VERT = 'varying vec3 vN;varying vec2 vUv;void main(){vN=normalize(normalMatrix*normal);vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';
    const LIGHT = 'vec3 L=normalize(vec3(-0.62,0.36,0.7));';
    function planet(radius, type, a, b, c, atm, ring) {
      const g = new T.Group(), col = (h) => ({ value: new T.Color(h) });
      const body = new T.Mesh(new T.SphereGeometry(radius, mobile ? 40 : 64, mobile ? 28 : 44), new T.ShaderMaterial({
        uniforms: { uTime, uType: { value: type }, cA: col(a), cB: col(b), cC: col(c), cAtm: col(atm) }, vertexShader: PLANET_VERT,
        fragmentShader: OCT + 'varying vec3 vN;varying vec2 vUv;uniform vec3 cA,cB,cC,cAtm;uniform float uType,uTime;' + NOISE + 'void main(){vec3 N=normalize(vN);' + LIGHT + 'float lit=smoothstep(-0.1,0.6,dot(N,L));float a=vUv.x*6.2832;vec2 q=vec2(cos(a),sin(a));vec3 col;if(uType<0.5){float w=fbm(q*1.6+vec2(vUv.y*5.0,-vUv.y*3.0));float bd=sin(vUv.y*36.0+w*5.0)*0.5+0.5;col=mix(cA,cB,bd);col=mix(col,cC,smoothstep(0.5,0.85,fbm(q*3.0+vec2(vUv.y*26.0,uTime*0.01))));}else{float n=fbm(q*2.4+vec2(vUv.y*6.0,vUv.y*4.0));col=mix(cA,cB,smoothstep(0.4,0.58,n));col=mix(col,cC,smoothstep(0.6,0.8,fbm(q*5.0+vec2(vUv.y*14.0,3.0))));}float rim=pow(1.0-max(N.z,0.0),3.0);gl_FragColor=vec4(col*(0.03+lit*1.05)+cAtm*rim*(0.18+lit*0.95),1.0);}'
      }));
      const glow = new T.Mesh(new T.SphereGeometry(radius * 1.14, 40, 28), new T.ShaderMaterial({
        uniforms: { cAtm: col(atm) }, transparent: true, depthWrite: false, side: T.BackSide, blending: T.AdditiveBlending, vertexShader: PLANET_VERT,
        fragmentShader: 'varying vec3 vN;uniform vec3 cAtm;void main(){' + LIGHT + 'float i=pow(clamp(-vN.z/0.5,0.0,1.0),1.6);float lit=smoothstep(-0.5,0.6,dot(normalize(vN.xy+vec2(0.0001)),normalize(L.xy)));gl_FragColor=vec4(cAtm*i*(0.12+lit*0.75),1.0);}'
      }));
      glow.renderOrder = 3; g.add(body, glow); g.userData.body = body;
      if (ring) {
        const r0 = radius * 1.45, r1 = radius * 2.35, rm = new T.Mesh(new T.RingGeometry(r0, r1, 128, 1), new T.ShaderMaterial({
          uniforms: { r0: { value: r0 }, r1: { value: r1 } }, transparent: true, depthWrite: false, side: T.DoubleSide,
          vertexShader: 'varying float vR;varying vec3 vP;uniform float r0,r1;void main(){vR=(length(position.xy)-r0)/(r1-r0);vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
          fragmentShader: 'varying float vR;void main(){float b=0.55+0.45*sin(vR*74.0)*sin(vR*23.0+1.0);float a=b*smoothstep(0.0,0.05,vR)*smoothstep(1.0,0.9,vR)*0.62;a*=smoothstep(0.0,0.02,abs(vR-0.6));vec3 c=mix(vec3(1.0,0.83,0.55),vec3(0.62,0.5,0.95),vR);gl_FragColor=vec4(c,a);}'
        }));
        rm.rotation.x = -1.28; rm.rotation.y = .22; rm.renderOrder = 3; g.add(rm);
      }
      scene.add(g); return g;
    }
    const giant = planet(84, 0, '#c9843a', '#5a3aa8', '#f2c98a', '#f5b352', true);
    const rocky = planet(34, 1, '#1c2a6e', '#4b3d9a', '#b9a6ff', '#7f9bff', false);
    const moon = planet(15, 1, '#3a2a55', '#7a5aa8', '#e0c8ff', '#b79bff', false);

    // ---- black hole: shadow, photon ring, lensed halo and a tilted accretion disk ----
    const hole = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShaderMaterial({
      uniforms: { uTime }, transparent: true, depthWrite: false, vertexShader: UV_VERT,
      fragmentShader: '#define OCT 3\nvarying vec2 vUv;uniform float uTime;' + NOISE + 'void main(){vec2 p=(vUv-0.5)*2.0;float r=length(p),ang=atan(p.y,p.x),rs=0.17;float halo=exp(-pow((r-rs*1.55)/0.075,2.0))*(0.6+0.4*noise(vec2(ang*3.0+uTime*0.22,r*20.0)));float ring=exp(-pow((r-rs*1.08)/0.013,2.0));vec2 q=vec2(p.x,p.y*4.3+0.02);float rd=length(q),da=atan(q.y,q.x);float disk=smoothstep(rs*1.25,rs*1.65,rd)*smoothstep(0.98,0.42,rd)*(0.5+0.5*noise(vec2(da*4.0-uTime*0.45/(rd+0.2),rd*15.0)));float front=step(q.y,0.0);float inS=step(r,rs*1.02);disk*=1.0-inS*(1.0-front);float dop=mix(0.4,1.4,smoothstep(0.7,-0.7,p.x));vec3 hot=vec3(1.0,0.88,0.64),amber=vec3(1.0,0.6,0.18),purple=vec3(0.56,0.3,1.0),blue=vec3(0.28,0.42,1.0);vec3 dc=mix(hot,amber,smoothstep(rs*1.3,0.5,rd));dc=mix(dc,purple,smoothstep(0.42,0.95,rd));vec3 col=dc*disk*dop*1.5+mix(amber,hot,0.45)*halo*dop*0.95+hot*ring*1.25+blue*exp(-r*3.0)*0.14+purple*exp(-r*2.2)*0.08;float sh=(1.0-smoothstep(rs*0.95,rs*1.02,r))*(1.0-clamp(disk*front*2.0,0.0,1.0));col*=1.0-sh;float a=clamp(max(sh,max(col.r,max(col.g,col.b))),0.0,1.0)*smoothstep(1.0,0.82,r);gl_FragColor=vec4(col,a);}'
    }));
    hole.renderOrder = 2; hole.rotation.z = -.32; scene.add(hole);

    // ---- shooting stars ----
    const shoots = [], SHOT_COL = ['#ffc56b', '#b79bff', '#ffffff', '#ffe2b0'];
    for (let i = 0; i < 8; i++) {
      const m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShaderMaterial({ uniforms: { uCol: { value: new T.Color('#fff') }, uA: { value: 0 } }, transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending, vertexShader: UV_VERT, fragmentShader: 'varying vec2 vUv;uniform vec3 uCol;uniform float uA;void main(){float w=1.0-abs(vUv.y-0.5)*2.0;float a=pow(vUv.x,2.6)*w*w*uA;vec3 c=mix(uCol,vec3(1.0),pow(vUv.x,10.0));gl_FragColor=vec4(c*a,a);}' }));
      m.visible = false; m.renderOrder = 5; scene.add(m); shoots.push({ m, t: 0, life: 0 });
    }
    let nextShot = 2.5, nextShow = rand(50, 90), queue = [];
    function launch(dir) {
      const s = shoots.find((x) => !x.m.visible); if (!s) return;
      const z = 320, hh = halfTan * z, hw = hh * W / H, a = dir != null ? dir + rand(-.08, .08) : (Math.random() < .5 ? rand(-2.75, -2.25) : rand(-.9, -.4));
      s.x = rand(-hw, hw) - Math.cos(a) * hw * .4; s.y = rand(hh * .15, hh * 1.05); s.vx = Math.cos(a); s.vy = Math.sin(a); s.sp = rand(520, 900); s.len = rand(90, 190); s.t = 0; s.life = rand(.75, 1.35);
      s.m.material.uniforms.uCol.value.set(SHOT_COL[Math.floor(Math.random() * SHOT_COL.length)]); s.m.rotation.z = a; s.m.scale.set(s.len, rand(1.6, 3), 1); s.m.visible = true;
    }

    function resize() {
      W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight);
      renderer.setPixelRatio(pr); renderer.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix(); uPx.value = pr * H / 900;
      const hh = halfTan * 2900; nebula.position.z = -2900; nebula.scale.set(hh * 2 * (W / H) * 1.25, hh * 2 * 1.25, 1);
    }
    let last = 0, slow = 0, frames = 0;
    return {
      resize,
      frame(t, motion) {
        const dt = Math.min(.1, Math.max(0, t - last)); last = t; uTime.value = t;
        const par = motion === 'full' ? getParallax() : { x: 0, y: 0 }, narrow = W / H < .8;
        cam.position.x += (par.x * 26 - cam.position.x) * .04; cam.position.y += (-par.y * 16 - cam.position.y) * .04; cam.lookAt(0, 0, -900);
        stars.rotation.y = t * .0035; stars.rotation.x = Math.sin(t * .01) * .04; dust.rotation.z = t * .006; dust.position.x = Math.sin(t * .05) * 30; galaxy.rotation.y = t * .012;
        place(galaxyG, narrow ? .35 : .5, .62, 1900); place(hole, narrow ? -.25 : -.52, narrow ? -.3 : -.12, 1000); hole.scale.setScalar(narrow ? 520 : 620);
        place(giant, (narrow ? .55 : .64) + Math.sin(t * .011) * .03, -.5 + Math.cos(t * .009) * .03, 560); giant.userData.body.rotation.y = t * .02; giant.rotation.z = .18;
        place(rocky, -.7 + Math.sin(t * .008 + 2) * .05, .52 + Math.cos(t * .01) * .04, 760); rocky.userData.body.rotation.y = t * .035;
        place(moon, .2 + Math.cos(t * .013) * .12, .74 + Math.sin(t * .013) * .05, 980); moon.userData.body.rotation.y = t * .05;
        if (motion !== 'off') {
          if (t > nextShot) { launch(); nextShot = t + (motion === 'subtle' ? rand(10, 22) : rand(3, 9)); }
          if (motion === 'full' && t > nextShow) { const d = Math.random() < .5 ? -2.5 : -.65; queue = Array.from({ length: 6 }, (_, i) => ({ at: t + i * .17, d })); nextShow = t + rand(70, 120); }
          while (queue.length && queue[0].at <= t) launch(queue.shift().d);
        }
        for (const s of shoots) { if (!s.m.visible) continue; s.t += dt; if (s.t >= s.life) { s.m.visible = false; continue; } const d = s.t * s.sp; s.m.position.set(s.x + s.vx * (d - s.len / 2), s.y + s.vy * (d - s.len / 2), -320); s.m.material.uniforms.uA.value = Math.sin(Math.PI * s.t / s.life); }
        const t0 = performance.now(); renderer.render(scene, cam); const cost = performance.now() - t0;
        // adapt: if a device struggles, draw fewer pixels and fewer stars instead of dropping frames
        if (++frames > 20 && frames < 200) { if (cost > 24) slow++; if (slow > 25 && pr > 1) { pr = 1; stars.geometry.setDrawRange(0, Math.floor(starN / 2)); slow = -1e9; resize(); } }
      },
      dispose() { renderer.dispose(); scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    };
  };
})(window.CC);
