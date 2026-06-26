        /**
         * Opencraft - Open Source Minecraft Clone
         */
        
        // --- GAME STATE ---
        const Game = {
            // Player properties
            player: {
                position: new THREE.Vector3(0, 8, 0),
                velocity: new THREE.Vector3(0, 0, 0),
                rotation: new THREE.Vector3(0, 0, 0),
                height: 1.8,
                radius: 0.35,
                speed: 6.0,
                jumpForce: 8.5,
                onGround: false,
                flying: false,
                lastSpaceTime: 0
            },
            
            // Selected hotbar materials
            hotbar: [
                { id: 1, name: 'Grass', textures: { top: 'grass_top.png', side: 'grass_side.png', bottom: 'grass_bottom.png' } },
                { id: 2, name: 'Dirt', textures: { top: 'dirt.png', side: 'dirt.png', bottom: 'dirt.png' } },
                { id: 3, name: 'Stone', textures: { top: 'stone.png', side: 'stone.png', bottom: 'stone.png' } },
                { id: 4, name: 'Log', textures: { top: 'log_top.png', side: 'log_side.png', bottom: 'log_top.png' } },
                { id: 5, name: 'Leaf', textures: { top: 'leaf.png', side: 'leaf.png', bottom: 'leaf.png' } }
            ],
            selectedSlot: 0,
            
            // World rendering params
            chunkSize: 16,
            renderDistance: 5, // chunks around player
            superflatHeight: 4, // 1 bedrock, 2 dirt, 1 grass top
            loadedChunks: {}, // Map of key "cx,cz" to Chunk object
            modifiedBlocks: {}, // Map of custom placed/broken blocks at global key "x,y,z" => id (0 for broken, >0 for custom placed)
            
            // Engine elements
            scene: null,
            camera: null,
            renderer: null,
            clock: null,
            textureCache: {},
            blockMaterials: {},
            
            // Audio engine variables
            audioContext: null,
            audioCache: {},
            
            // Input Trackers
            keysPressed: {},
            pointerLocked: false,
            controlsInitialized: false, // Flag to prevent multi-registration bugs
            
            // Selector Box Mesh
            selectionBox: null,
            lastRaycastBlock: null,

            // Save tracking
            dirty: false,
            lastSaveTime: Date.now(),
            autoSaveInterval: null
        };

        // --- CONSTANTS ---
        const BLOCK_IDS = {
            AIR: 0,
            GRASS: 1,
            DIRT: 2,
            STONE: 3,
            LOG: 4,
            LEAF: 5
        };

        // Custom names matching images and audio configs
        const BLOCK_CONFIGS = {
            [BLOCK_IDS.GRASS]: { name: 'grass', displayName: 'Grass', breakSound: 'grass_break', walkSound: 'grass_walk' },
            [BLOCK_IDS.DIRT]: { name: 'dirt', displayName: 'Dirt', breakSound: 'dirt_break', walkSound: 'dirt_walk' },
            [BLOCK_IDS.STONE]: { name: 'stone', displayName: 'Stone', breakSound: 'stone_break', walkSound: 'stone_walk' },
            [BLOCK_IDS.LOG]: { name: 'log', displayName: 'Log', breakSound: 'log_break', walkSound: 'log_walk' },
            [BLOCK_IDS.LEAF]: { name: 'leaf', displayName: 'Leaf', breakSound: 'leaf_break', walkSound: 'leaf_walk' }
        };

        const GRAVITY = -22.0;

        // --- GAME INITIALIZATION ---
        window.addEventListener('DOMContentLoaded', () => {
            initMenuListeners();
            initHotbarUI();
        });

        function initMenuListeners() {
            document.getElementById('btn-new-world').addEventListener('click', () => {
                startGame(false);
            });
            document.getElementById('btn-load-local').addEventListener('click', () => {
                startGame(true);
            });
            document.getElementById('btn-load-file').addEventListener('click', () => {
                document.getElementById('file-input').click();
            });
            document.getElementById('file-input').addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = function(event) {
                        try {
                            const data = JSON.parse(event.target.result);
                            if (data.modifiedBlocks) {
                                Game.modifiedBlocks = data.modifiedBlocks;
                                if (data.playerPosition) {
                                    Game.player.position.copy(data.playerPosition);
                                }
                                showAlert("Loaded from JSON successfully!");
                                startGame(false, true); // start using loaded configurations
                            } else {
                                showAlert("Invalid JSON save file!");
                            }
                        } catch(err) {
                            showAlert("Error parsing save file.");
                        }
                    };
                    reader.readAsText(file);
                }
            });

            // Pause Menu buttons
            document.getElementById('btn-resume').addEventListener('click', () => {
                requestPointerLock();
            });
            document.getElementById('btn-save-progress').addEventListener('click', () => {
                saveToLocalStorage();
            });
            document.getElementById('btn-export-json').addEventListener('click', () => {
                exportToJsonFile();
            });
            document.getElementById('btn-quit').addEventListener('click', () => {
                quitToMainMenu();
            });

            // Hotbar quick clicks
            for (let i = 0; i < 5; i++) {
                const slot = document.getElementById(`slot-${i}`);
                if (slot) {
                    slot.addEventListener('click', () => {
                        selectHotbarSlot(i);
                    });
                }
            }
        }

        // --- LAUNCH GAME ---
        function startGame(loadFromLocalStorageRequested = false, alreadyParsed = false) {
            // Hide main menu, show HUD
            document.getElementById('main-menu').classList.add('hidden');
            document.getElementById('game-hud').classList.remove('hidden');

            if (loadFromLocalStorageRequested) {
                const loaded = loadFromLocalStorage();
                if (!loaded) {
                    showAlert("No saved world found in LocalStorage. Generating new world!");
                }
            } else if (!alreadyParsed) {
                // Clear any leftover data if starting fresh
                Game.modifiedBlocks = {};
                Game.player.position.set(0, 8, 0);
                Game.player.velocity.set(0, 0, 0);
            }

            // Reset state trackers
            Game.dirty = false;
            Game.lastSaveTime = Date.now();
            Game.player.flying = false;
            Game.player.lastSpaceTime = 0;
            Game.keysPressed = {};

            // Initialize Three.js Engine
            initThree();

            // Setup input event listeners (guarded against duplicate registrations)
            initControls();

            // Lock pointer to begin
            requestPointerLock();

            // Start auto-save background monitoring
            if (Game.autoSaveInterval) clearInterval(Game.autoSaveInterval);
            Game.autoSaveInterval = setInterval(() => {
                if (Game.dirty && (Date.now() - Game.lastSaveTime >= 60000)) {
                    saveToLocalStorage(true);
                }
            }, 5000); // Poll dirty flag status every 5 seconds

            // Start loops
            animate();
        }

        // --- SOUND PLAYER (Fails Silently as requested) ---
        function playBlockSound(blockType, type = 'break') {
            const config = BLOCK_CONFIGS[blockType];
            if (!config) return;

            const soundName = type === 'break' ? config.breakSound : config.walkSound;
            const audioPath = `audio/${soundName}.mp3`;

            // Try to load standard local audio file via Audio element
            const audio = new Audio(audioPath);
            audio.volume = 0.5;
            
            audio.play().catch(() => {
                // Fail silently: weird synthesized noises removed
            });
        }

        // --- TEXTURE LOADER & PROCEDURAL PIXEL-ART GENERATORS ---
        function drawProceduralCanvas(canvas, type, side) {
            const ctx = canvas.getContext('2d');
            
            // Generate procedural pixel-art patterns
            if (type === 'grass') {
                if (side === 'top') {
                    // Green grass variation
                    for (let x = 0; x < 16; x++) {
                        for (let y = 0; y < 16; y++) {
                            const val = Math.floor(Math.random() * 40) + 100;
                            ctx.fillStyle = `rgb(${Math.floor(val * 0.4)}, ${val}, ${Math.floor(val * 0.3)})`;
                            ctx.fillRect(x, y, 1, 1);
                        }
                    }
                } else if (side === 'bottom') {
                    // Solid brown dirt
                    for (let x = 0; x < 16; x++) {
                        for (let y = 0; y < 16; y++) {
                            const val = Math.floor(Math.random() * 30) + 70;
                            ctx.fillStyle = `rgb(${val}, ${Math.floor(val * 0.75)}, ${Math.floor(val * 0.55)})`;
                            ctx.fillRect(x, y, 1, 1);
                        }
                    }
                } else {
                    // Side: grass line on top of dirt
                    for (let x = 0; x < 16; x++) {
                        for (let y = 0; y < 16; y++) {
                            if (y < 4 + Math.floor(Math.sin(x * 0.8) * 1.5)) {
                                const val = Math.floor(Math.random() * 40) + 100;
                                ctx.fillStyle = `rgb(${Math.floor(val * 0.4)}, ${val}, ${Math.floor(val * 0.3)})`;
                            } else {
                                const val = Math.floor(Math.random() * 30) + 70;
                                ctx.fillStyle = `rgb(${val}, ${Math.floor(val * 0.75)}, ${Math.floor(val * 0.55)})`;
                            }
                            ctx.fillRect(x, y, 1, 1);
                        }
                    }
                }
            } else if (type === 'dirt') {
                for (let x = 0; x < 16; x++) {
                    for (let y = 0; y < 16; y++) {
                        const val = Math.floor(Math.random() * 30) + 70;
                        ctx.fillStyle = `rgb(${val}, ${Math.floor(val * 0.75)}, ${Math.floor(val * 0.55)})`;
                        ctx.fillRect(x, y, 1, 1);
                    }
                }
            } else if (type === 'stone') {
                for (let x = 0; x < 16; x++) {
                    for (let y = 0; y < 16; y++) {
                        const val = Math.floor(Math.random() * 40) + 110;
                        ctx.fillStyle = `rgb(${val}, ${val}, ${val})`;
                        ctx.fillRect(x, y, 1, 1);
                    }
                }
            } else if (type === 'log') {
                if (side === 'top' || side === 'bottom') {
                    // Tree trunk rings
                    for (let x = 0; x < 16; x++) {
                        for (let y = 0; y < 16; y++) {
                            const dx = x - 7.5;
                            const dy = y - 7.5;
                            const dist = Math.sqrt(dx*dx + dy*dy);
                            if (dist < 3) {
                                ctx.fillStyle = '#b08754';
                            } else if (dist < 6) {
                                ctx.fillStyle = '#cfa068';
                            } else {
                                ctx.fillStyle = '#5a462a';
                            }
                            ctx.fillRect(x, y, 1, 1);
                        }
                    }
                } else {
                    // Tree bark lines
                    for (let x = 0; x < 16; x++) {
                        for (let y = 0; y < 16; y++) {
                            const val = Math.floor(Math.random() * 20) + 50;
                            if (x === 3 || x === 7 || x === 11) {
                                            ctx.fillStyle = `rgb(${Math.floor(val*0.6)}, ${Math.floor(val*0.5)}, ${Math.floor(val*0.4)})`;
                            } else {
                                ctx.fillStyle = `rgb(val, ${Math.floor(val * 0.8)}, ${Math.floor(val * 0.6)})`;
                            }
                            ctx.fillRect(x, y, 1, 1);
                        }
                    }
                }
            } else if (type === 'leaf') {
                for (let x = 0; x < 16; x++) {
                    for (let y = 0; y < 16; y++) {
                        const val = Math.floor(Math.random() * 30) + 50;
                        if (Math.random() > 0.85) {
                            ctx.fillStyle = `rgba(10, 30, 5, 0.25)`;
                        } else {
                            ctx.fillStyle = `rgb(10, ${val}, 15)`;
                        }
                        ctx.fillRect(x, y, 1, 1);
                    }
                }
            }
        }

        function createProceduralTexture(type, side) {
            const canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 16;
            drawProceduralCanvas(canvas, type, side);
            const tex = new THREE.CanvasTexture(canvas);
            tex.magFilter = THREE.NearestFilter;
            tex.minFilter = THREE.NearestFilter;
            return tex;
        }

        function createProceduralDataURL(type, side) {
            const canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 16;
            drawProceduralCanvas(canvas, type, side);
            return canvas.toDataURL();
        }

        function loadTexture(blockType, side) {
            const blockConfig = BLOCK_CONFIGS[blockType];
            if (!blockConfig) return null;

            const name = blockConfig.name;
            let filename = '';

            // Map standard layout sides
            if (name === 'grass') {
                filename = side === 'top' ? 'grass_top.png' : (side === 'bottom' ? 'grass_bottom.png' : 'grass_side.png');
            } else if (name === 'log') {
                filename = (side === 'top' || side === 'bottom') ? 'log_top.png' : 'log_side.png';
            } else {
                filename = `${name}.png`;
            }

            const cacheKey = `${blockType}_${side}`;
            if (Game.textureCache[cacheKey]) return Game.textureCache[cacheKey];

            // Always create a dynamic canvas-based texture first as fallback
            const fallbackTex = createProceduralTexture(name, side);
            Game.textureCache[cacheKey] = fallbackTex;

            // Attempt to load the external asset as configured
            const loader = new THREE.TextureLoader();
            loader.load(`images/${filename}`, 
                (loadedTexture) => {
                    // Update fallback texture contents with loaded asset properties
                    loadedTexture.magFilter = THREE.NearestFilter;
                    loadedTexture.minFilter = THREE.NearestFilter;
                    Game.textureCache[cacheKey].image = loadedTexture.image;
                    Game.textureCache[cacheKey].needsUpdate = true;
                },
                undefined,
                (err) => {
                    // Fail silently, fallback already assigned & visual texture exists!
                }
            );

            return Game.textureCache[cacheKey];
        }

        // Setup material configurations for all blocks
        function initMaterials() {
            Object.keys(BLOCK_CONFIGS).forEach(bId => {
                const id = parseInt(bId);
                const materials = [];
                // Standard block material maps faces in order: +X, -X, +Y, -Y, +Z, -Z
                // Mapping: [0] Right, [1] Left, [2] Top, [3] Bottom, [4] Front, [5] Back
                const sides = ['side', 'side', 'top', 'bottom', 'side', 'side'];

                sides.forEach(side => {
                    const tex = loadTexture(id, side);
                    materials.push(new THREE.MeshLambertMaterial({ 
                        map: tex,
                        transparent: id === BLOCK_IDS.LEAF,
                        alphaTest: id === BLOCK_IDS.LEAF ? 0.2 : 0
                    }));
                });

                Game.blockMaterials[id] = materials;
            });
        }

        // Populate Hotbar Slots with Actual Block Image textures
        function initHotbarUI() {
            const slotImages = [
                { id: 0, file: 'images/grass_top.png', fallbackType: 'grass', side: 'top' },
                { id: 1, file: 'images/dirt.png', fallbackType: 'dirt', side: 'side' },
                { id: 2, file: 'images/stone.png', fallbackType: 'stone', side: 'side' },
                { id: 3, file: 'images/log_side.png', fallbackType: 'log', side: 'side' },
                { id: 4, file: 'images/leaf.png', fallbackType: 'leaf', side: 'side' }
            ];

            slotImages.forEach(slot => {
                const element = document.querySelector(`#slot-${slot.id} .slot-image`);
                if (!element) return;

                // Create a temporary image loader to verify the texture path before rendering
                const img = new Image();
                img.src = slot.file;
                img.onload = () => {
                    element.style.backgroundImage = `url(${slot.file})`;
                };
                img.onerror = () => {
                    // Rollback safely to procedural rendering canvas patterns
                    const fallbackDataURL = createProceduralDataURL(slot.fallbackType, slot.side);
                    element.style.backgroundImage = `url(${fallbackDataURL})`;
                };
            });
        }

        // --- THREE.JS SCENE CREATION ---
        function initThree() {
            const container = document.getElementById('canvas-container');
            container.innerHTML = ''; // clear old canvas if restarting

            // Scene & Camera
            Game.scene = new THREE.Scene();
            Game.scene.background = new THREE.Color(0x7ec0ee); // Sky blue
            Game.scene.fog = new THREE.FogExp2(0x7ec0ee, 0.025);

            Game.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            Game.camera.position.copy(Game.player.position);

            // WebGL Renderer setup
            Game.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
            Game.renderer.setSize(window.innerWidth, window.innerHeight);
            Game.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            container.appendChild(Game.renderer.domElement);

            // Lighting Setup
            const ambientLight = new THREE.AmbientLight(0xcccccc, 0.5);
            Game.scene.add(ambientLight);

            const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
            sunLight.position.set(500, 1000, 250);
            Game.scene.add(sunLight);

            // Prep Materials
            initMaterials();

            // Create selection outline box
            const geo = new THREE.BoxGeometry(1.01, 1.01, 1.01);
            const edges = new THREE.EdgesGeometry(geo);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 }));
            Game.selectionBox = line;
            Game.selectionBox.visible = false;
            Game.scene.add(Game.selectionBox);

            Game.clock = new THREE.Clock();

            // Initialize dynamic world building
            updateChunks(true);

            // Handle browser resize
            window.addEventListener('resize', onWindowResize);
        }

        function onWindowResize() {
            if (Game.camera && Game.renderer) {
                Game.camera.aspect = window.innerWidth / window.innerHeight;
                Game.camera.updateProjectionMatrix();
                Game.renderer.setSize(window.innerWidth, window.innerHeight);
            }
        }

        // --- INFINITE WORLD & CHUNK LOGIC ---
        class Chunk {
            constructor(cx, cz) {
                this.cx = cx;
                this.cz = cz;
                this.blocks = {}; // key "lx,ly,lz" => blockId
                this.mesh = null;
                this.group = new THREE.Group();

                this.generate();
            }

            generate() {
                const startX = this.cx * Game.chunkSize;
                const startZ = this.cz * Game.chunkSize;

                // 1. Generate Superflat Base Layer
                for (let x = 0; x < Game.chunkSize; x++) {
                    for (let z = 0; z < Game.chunkSize; z++) {
                        const gx = startX + x;
                        const gz = startZ + z;

                        for (let y = 0; y < Game.superflatHeight; y++) {
                            const customKey = `${gx},${y},${gz}`;
                            // If modified globally, apply modification instead of default
                            if (Game.modifiedBlocks[customKey] !== undefined) {
                                const bid = Game.modifiedBlocks[customKey];
                                if (bid !== BLOCK_IDS.AIR) {
                                    this.blocks[`${x},${y},${z}`] = bid;
                                }
                            } else {
                                if (y === 0) {
                                    this.blocks[`${x},${y},${z}`] = BLOCK_IDS.STONE; // Base bedrock
                                } else if (y < Game.superflatHeight - 1) {
                                    this.blocks[`${x},${y},${z}`] = BLOCK_IDS.DIRT;
                                } else {
                                    this.blocks[`${x},${y},${z}`] = BLOCK_IDS.GRASS;
                                }
                            }
                        }
                    }
                }

                // 2. Tree Spawning (Procedural Pseudo-random placement on chunk load)
                // Use deterministic seed based on chunk coordinates so trees spawn consistently
                const seed = Math.sin(this.cx * 12.9898 + this.cz * 78.233) * 43758.5453;
                const rand = (offset) => {
                    const x = Math.sin(seed + offset) * 10000;
                    return x - Math.floor(x);
                };

                // Place up to 2 trees per chunk
                const numTrees = Math.floor(rand(1) * 3); // 0, 1, or 2 trees
                for (let i = 0; i < numTrees; i++) {
                    const tx = Math.floor(rand(2 + i) * Game.chunkSize);
                    const tz = Math.floor(rand(3 + i) * Game.chunkSize);
                    const ty = Game.superflatHeight; // Place tree trunk starting directly on top of grass

                    const gx = startX + tx;
                    const gz = startZ + tz;

                    // Always run tree spawning logic during generation.
                    // User modifications (broken blocks/placed blocks) are layered on top cleanly in step 3.
                    this.spawnTree(tx, ty, tz, gx, gz);
                }

                // 3. Apply any user placed / removed blocks that don't match superflat defaults
                // We scan custom block changes within this chunk coordinates space
                Object.keys(Game.modifiedBlocks).forEach(key => {
                    const [gx, gy, gz] = key.split(',').map(Number);
                    // Determine if coordinates lie inside this chunk
                    const lcx = Math.floor(gx / Game.chunkSize);
                    const lcz = Math.floor(gz / Game.chunkSize);

                    if (lcx === this.cx && lcz === this.cz) {
                        const lx = ((gx % Game.chunkSize) + Game.chunkSize) % Game.chunkSize;
                        const lz = ((gz % Game.chunkSize) + Game.chunkSize) % Game.chunkSize;
                        const bid = Game.modifiedBlocks[key];

                        if (bid === BLOCK_IDS.AIR) {
                            delete this.blocks[`${lx},${gy},${lz}`];
                        } else {
                            this.blocks[`${lx},${gy},${lz}`] = bid;
                        }
                    }
                });

                this.buildMesh();
            }

            spawnTree(lx, ly, lz, gx, gz) {
                const trunkHeight = 4;
                // Grow log trunk
                for (let h = 0; h < trunkHeight; h++) {
                    const y = ly + h;
                    const logKey = `${gx},${y},${gz}`;
                    if (Game.modifiedBlocks[logKey] === undefined) {
                        this.blocks[`${lx},${y},${lz}`] = BLOCK_IDS.LOG;
                    }
                }

                // Grow leaf crown around top logs
                const leafCenterY = ly + trunkHeight - 1;
                for (let dx = -2; dx <= 2; dx++) {
                    for (let dz = -2; dz <= 2; dz++) {
                        for (let dy = 0; dy <= 2; dy++) {
                            const leafY = leafCenterY + dy;
                            // Make leaf shape rounded
                            if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && dy > 0) continue;

                            const glx = gx + dx;
                            const glz = gz + dz;
                            const leafKey = `${glx},${leafY},${glz}`;

                            // Determine local coordinates in this chunk
                            const chunkX = Math.floor(glx / Game.chunkSize);
                            const chunkZ = Math.floor(glz / Game.chunkSize);

                            if (chunkX === this.cx && chunkZ === this.cz) {
                                const locX = ((glx % Game.chunkSize) + Game.chunkSize) % Game.chunkSize;
                                const locZ = ((glz % Game.chunkSize) + Game.chunkSize) % Game.chunkSize;

                                // Don't overwrite existing logs
                                if (!this.blocks[`${locX},${leafY},${locZ}`] && Game.modifiedBlocks[leafKey] === undefined) {
                                    this.blocks[`${locX},${leafY},${locZ}`] = BLOCK_IDS.LEAF;
                                }
                            } else {
                                // Leaf spilled over into adjacent chunk. Record it in modifiedBlocks so that chunk gets it on generation
                                if (Game.modifiedBlocks[leafKey] === undefined) {
                                    Game.modifiedBlocks[leafKey] = BLOCK_IDS.LEAF;
                                }
                            }
                        }
                    }
                }
            }

            buildMesh() {
                // Clear old meshes
                if (this.group.children.length > 0) {
                    this.group.clear();
                }

                const geometry = new THREE.BoxGeometry(1, 1, 1);
                const instancedMeshes = {};

                // Find counts of each block to create InstancedMeshes for stellar rendering performance
                const counts = {};
                Object.keys(this.blocks).forEach(key => {
                    const bid = this.blocks[key];
                    counts[bid] = (counts[bid] || 0) + 1;
                });

                // Prepare instanced meshes
                Object.keys(counts).forEach(bidStr => {
                    const bid = parseInt(bidStr);
                    const count = counts[bid];
                    const instMesh = new THREE.InstancedMesh(geometry, Game.blockMaterials[bid], count);
                    instancedMeshes[bid] = {
                        mesh: instMesh,
                        index: 0
                    };
                    this.group.add(instMesh);
                });

                // Populate instanced matrixes
                const matrix = new THREE.Matrix4();
                const position = new THREE.Vector3();
                const startX = this.cx * Game.chunkSize;
                const startZ = this.cz * Game.chunkSize;

                Object.keys(this.blocks).forEach(key => {
                    const [lx, ly, lz] = key.split(',').map(Number);
                    const bid = this.blocks[key];

                    // Check if block is completely surrounded (Occlusion Culling)
                    // If surrounded, skip rendering to boost FPS
                    let surrounded = true;
                    const neighbors = [
                        [1, 0, 0], [-1, 0, 0],
                        [0, 1, 0], [0, -1, 0],
                        [0, 0, 1], [0, 0, -1]
                    ];

                    for (let n = 0; n < neighbors.length; n++) {
                        const nlx = lx + neighbors[n][0];
                        const nly = ly + neighbors[n][1];
                        const nlz = lz + neighbors[n][2];

                        // Neighbors that go beyond height limits don't block visual flow
                        if (nly < 0) continue;

                        let neighborBid;
                        if (nlx < 0 || nlx >= Game.chunkSize || nlz < 0 || nlz >= Game.chunkSize) {
                            // Check global block map
                            const gX = startX + nlx;
                            const gZ = startZ + nlz;
                            neighborBid = getBlockAtGlobal(gX, nly, gZ);
                        } else {
                            neighborBid = this.blocks[`${nlx},${nly},${nlz}`];
                        }

                        if (!neighborBid || neighborBid === BLOCK_IDS.LEAF) {
                            surrounded = false;
                            break;
                        }
                    }

                    if (!surrounded || bid === BLOCK_IDS.LEAF) {
                        const inst = instancedMeshes[bid];
                        position.set(startX + lx, ly, startZ + lz);
                        matrix.makeTranslation(position.x, position.y, position.z);
                        inst.mesh.setMatrixAt(inst.index, matrix);
                        inst.index++;
                    }
                });

                // Update instance markers
                Object.keys(instancedMeshes).forEach(bid => {
                    instancedMeshes[bid].mesh.instanceMatrix.needsUpdate = true;
                });

                Game.scene.add(this.group);
            }

            destroy() {
                Game.scene.remove(this.group);
                this.group.clear();
            }
        }

        // Helper to retrieve block id at precise global space coords
        function getBlockAtGlobal(x, y, z) {
            const rx = Math.round(x);
            const ry = Math.round(y);
            const rz = Math.round(z);

            if (ry < 0) return BLOCK_IDS.AIR;

            const key = `${rx},${ry},${rz}`;
            if (Game.modifiedBlocks[key] !== undefined) {
                return Game.modifiedBlocks[key];
            }

            // Check loaded chunks for procedural assets (like solid logs & leaves)
            const cx = Math.floor(rx / Game.chunkSize);
            const cz = Math.floor(rz / Game.chunkSize);
            const chunkKey = `${cx},${cz}`;
            if (Game.loadedChunks[chunkKey]) {
                const lx = ((rx % Game.chunkSize) + Game.chunkSize) % Game.chunkSize;
                const lz = ((rz % Game.chunkSize) + Game.chunkSize) % Game.chunkSize;
                const blockKey = `${lx},${ry},${lz}`;
                if (Game.loadedChunks[chunkKey].blocks[blockKey] !== undefined) {
                    return Game.loadedChunks[chunkKey].blocks[blockKey];
                }
            }

            // Normal superflat floor generation
            if (ry === 0) return BLOCK_IDS.STONE;
            if (ry < Game.superflatHeight - 1) return BLOCK_IDS.DIRT;
            if (ry === Game.superflatHeight - 1) return BLOCK_IDS.GRASS;

            return BLOCK_IDS.AIR;
        }

        // Dynamically load, unload and build chunk areas around player
        function updateChunks(force = false) {
            const px = Game.player.position.x;
            const pz = Game.player.position.z;

            const currentCx = Math.floor(px / Game.chunkSize);
            const currentCz = Math.floor(pz / Game.chunkSize);

            // Determine rendering range bounds
            const activeKeys = new Set();
            for (let dx = -Game.renderDistance; dx <= Game.renderDistance; dx++) {
                for (let dz = -Game.renderDistance; dz <= Game.renderDistance; dz++) {
                    const cx = currentCx + dx;
                    const cz = currentCz + dz;
                    const key = `${cx},${cz}`;
                    activeKeys.add(key);

                    if (!Game.loadedChunks[key]) {
                        Game.loadedChunks[key] = new Chunk(cx, cz);
                    }
                }
            }

            // Unload distant chunks to save computing resources
            Object.keys(Game.loadedChunks).forEach(key => {
                if (!activeKeys.has(key)) {
                    Game.loadedChunks[key].destroy();
                    delete Game.loadedChunks[key];
                }
            });

            // Rebuild chunk mesh if custom modifications were done inside them
            if (force) {
                Object.keys(Game.loadedChunks).forEach(key => {
                    Game.loadedChunks[key].destroy();
                    const [cx, cz] = key.split(',').map(Number);
                    Game.loadedChunks[key] = new Chunk(cx, cz);
                });
            }

            // Update UI diagnostics HUD
            document.getElementById('chunk-display').innerText = `Chunk: ${currentCx}, ${currentCz}`;
        }

        // Extremely fast local chunk rebuilding (resolves modification lags)
        function rebuildChunksAroundBlock(gx, gz) {
            const cx = Math.floor(gx / Game.chunkSize);
            const cz = Math.floor(gz / Game.chunkSize);
            
            rebuildChunk(cx, cz);
            
            // Rebuild adjacent chunks if the modified block sits directly on the boundary
            const lx = ((gx % Game.chunkSize) + Game.chunkSize) % Game.chunkSize;
            const lz = ((gz % Game.chunkSize) + Game.chunkSize) % Game.chunkSize;
            
            if (lx === 0) rebuildChunk(cx - 1, cz);
            if (lx === Game.chunkSize - 1) rebuildChunk(cx + 1, cz);
            if (lz === 0) rebuildChunk(cx, cz - 1);
            if (lz === Game.chunkSize - 1) rebuildChunk(cx, cz + 1);
        }

        function rebuildChunk(cx, cz) {
            const key = `${cx},${cz}`;
            if (Game.loadedChunks[key]) {
                Game.loadedChunks[key].destroy();
                delete Game.loadedChunks[key];
                Game.loadedChunks[key] = new Chunk(cx, cz);
            }
        }

        // --- GAME CONTROLS & POINTER LOCK ---
        function initControls() {
            // Prevent registering multiple handlers upon loading worlds
            if (Game.controlsInitialized) return;
            Game.controlsInitialized = true;

            // Mouse Interaction setup
            window.addEventListener('mousedown', (e) => {
                // If clicking an interactive button or main/pause menus are open, do not intercept
                if (e.target.closest('#main-menu') || e.target.closest('#pause-menu') || e.target.tagName === 'BUTTON') {
                    return;
                }

                if (!Game.pointerLocked) {
                    requestPointerLock();
                    return;
                }

                if (e.button === 0) {
                    // Left click: Break Block
                    handleInteraction(true);
                } else if (e.button === 2) {
                    // Right click: Place Block
                    handleInteraction(false);
                }
            });

            // Prevent right-click context menu in browser
            window.addEventListener('contextmenu', e => e.preventDefault());

            // Pointer Lock state handlers
            document.addEventListener('pointerlockchange', () => {
                if (document.pointerLockElement === document.body) {
                    Game.pointerLocked = true;
                    document.getElementById('pause-menu').classList.add('hidden');
                } else {
                    Game.pointerLocked = false;
                    document.getElementById('pause-menu').classList.remove('hidden');
                }
            });

            // Track keys
            window.addEventListener('keydown', (e) => {
                const keyLower = e.key.toLowerCase();
                Game.keysPressed[keyLower] = true;

                // Detect double-tap space for flying
                if (e.key === ' ') {
                    // Ignore repeated events triggered by OS key-repeat
                    if (e.repeat) return;
                    
                    const now = Date.now();
                    if (now - Game.player.lastSpaceTime < 250) {
                        Game.player.flying = !Game.player.flying;
                        Game.player.velocity.y = 0; // stop vertical drift immediately
                        showAlert(Game.player.flying ? "Flying: Enabled" : "Flying: Disabled");
                    }
                    Game.player.lastSpaceTime = now;
                }

                // Keyboard quick selection
                if (e.key >= '1' && e.key <= '5') {
                    selectHotbarSlot(parseInt(e.key) - 1);
                }

                // Hotkey 'P' - Quick Save to LocalStorage
                if (keyLower === 'p') {
                    saveToLocalStorage();
                }

                // Hotkey 'O' - Quick Export JSON file
                if (keyLower === 'o') {
                    exportToJsonFile();
                }
            });

            window.addEventListener('keyup', (e) => {
                Game.keysPressed[e.key.toLowerCase()] = false;
            });

            // Mouse scroll to cycle hotbar - scrolls 1 slot at a time!
            window.addEventListener('wheel', (e) => {
                if (!Game.pointerLocked) return;
                const direction = e.deltaY > 0 ? 1 : -1;
                let slot = (Game.selectedSlot + direction) % 5;
                if (slot < 0) slot += 5; // ensure safe wrap-around matching hotbar length
                selectHotbarSlot(slot);
            });

            // Mouse movement camera controls
            window.addEventListener('mousemove', (e) => {
                if (!Game.pointerLocked) return;

                const sensitivity = 0.0022;
                Game.player.rotation.y -= e.movementX * sensitivity;
                Game.player.rotation.x -= e.movementY * sensitivity;

                // Clamp pitch so camera can't loop upside down
                Game.player.rotation.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, Game.player.rotation.x));
            });
        }

        function requestPointerLock() {
            document.body.requestPointerLock();
        }

        function selectHotbarSlot(index) {
            // Remove selection class from old hotbar slot UI element
            document.getElementById(`slot-${Game.selectedSlot}`).classList.remove('hotbar-selected');
            Game.selectedSlot = index;
            document.getElementById(`slot-${Game.selectedSlot}`).classList.add('hotbar-selected');

            // Update displayed HUD name
            const blockConfig = Game.hotbar[index];
            document.getElementById('active-block-name').innerText = `Selected: ${blockConfig.name}`;
        }

        // --- BLOCK BREAKING & PLACING LOGIC ---
        function handleInteraction(isBreaking) {
            if (!Game.lastRaycastBlock) return;

            const target = Game.lastRaycastBlock.target; // global coordinates of targeted block
            const normal = Game.lastRaycastBlock.normal; // side normal of target intersection

            const tx = Math.round(target.x);
            const ty = Math.round(target.y);
            const tz = Math.round(target.z);

            if (isBreaking) {
                // Break: Verify target isn't absolute baseline bedrock (y=0)
                if (ty === 0) return;

                const targetType = getBlockAtGlobal(tx, ty, tz);
                if (targetType === BLOCK_IDS.AIR) return;

                // Track modification & delete block
                const key = `${tx},${ty},${tz}`;
                Game.modifiedBlocks[key] = BLOCK_IDS.AIR;
                Game.dirty = true;

                // Play sound
                playBlockSound(targetType, 'break');

                // Re-render only locally modified regions instantly
                rebuildChunksAroundBlock(tx, tz);
            } else {
                // Place block in neighbor space relative to hit surface
                const px = tx + Math.round(normal.x);
                const py = ty + Math.round(normal.y);
                const pz = tz + Math.round(normal.z);

                // Prevent placing below coordinate boundaries
                if (py < 0) return;

                // Prevent placing block inside player's body boundaries (AABB collision)
                const playerBox = {
                    minX: Game.player.position.x - Game.player.radius,
                    maxX: Game.player.position.x + Game.player.radius,
                    minY: Game.player.position.y - Game.player.height,
                    maxY: Game.player.position.y + 0.2, // slightly above height
                    minZ: Game.player.position.z - Game.player.radius,
                    maxZ: Game.player.position.z + Game.player.radius
                };

                const blockBox = {
                    minX: px - 0.5, maxX: px + 0.5,
                    minY: py - 0.5, maxY: py + 0.5,
                    minZ: pz - 0.5, maxZ: pz + 0.5
                };

                const overlaps = (playerBox.minX < blockBox.maxX && playerBox.maxX > blockBox.minX) &&
                                 (playerBox.minY < blockBox.maxY && playerBox.maxY > blockBox.minY) &&
                                 (playerBox.minZ < blockBox.maxZ && playerBox.maxZ > blockBox.minZ);

                if (overlaps) return; // Placed inside player! Cancel.

                const selectedBlockId = Game.hotbar[Game.selectedSlot].id;
                const key = `${px},${py},${pz}`;
                Game.modifiedBlocks[key] = selectedBlockId;
                Game.dirty = true;

                // Play sound
                playBlockSound(selectedBlockId, 'break');

                // Re-render only locally modified regions instantly
                rebuildChunksAroundBlock(px, pz);
            }
        }

        // Raycasting algorithm specifically optimized for voxel engines
        function performRaycast() {
            const start = Game.camera.position.clone();
            const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(Game.camera.quaternion).normalize();

            // Maximum reach range (4.5 units matches vanilla survival range)
            const maxReach = 5.0;
            const step = 0.05;
            let current = start.clone();

            for (let d = 0; d < maxReach; d += step) {
                current.addScaledVector(direction, step);

                const rx = Math.round(current.x);
                const ry = Math.round(current.y);
                const rz = Math.round(current.z);

                const bId = getBlockAtGlobal(rx, ry, rz);
                if (bId !== BLOCK_IDS.AIR) {
                    // Block target identified! Find intersect normal face
                    const diff = current.clone().sub(new THREE.Vector3(rx, ry, rz));
                    const absDiff = new THREE.Vector3(Math.abs(diff.x), Math.abs(diff.y), Math.abs(diff.z));

                    let normal = new THREE.Vector3();
                    if (absDiff.x > absDiff.y && absDiff.x > absDiff.z) {
                        normal.x = diff.x > 0 ? 1 : -1;
                    } else if (absDiff.y > absDiff.x && absDiff.y > absDiff.z) {
                        normal.y = diff.y > 0 ? 1 : -1;
                    } else {
                        normal.z = diff.z > 0 ? 1 : -1;
                    }

                    Game.lastRaycastBlock = {
                        target: new THREE.Vector3(rx, ry, rz),
                        normal: normal
                    };

                    // Draw selection box
                    Game.selectionBox.position.set(rx, ry, rz);
                    Game.selectionBox.visible = true;
                    return;
                }
            }

            // Clear targeting wireframe if target trace missed
            Game.lastRaycastBlock = null;
            Game.selectionBox.visible = false;
        }

        // --- PHYSICS & COLLISION SYSTEM ---
        function updatePlayerPhysics(dt) {
            // Clamp DT to avoid wild clip movements when frame hiccups occur
            dt = Math.min(dt, 0.1);

            // 1. Gravity (Only apply when not flying)
            if (!Game.player.flying) {
                Game.player.velocity.y += GRAVITY * dt;
            } else {
                // Flying controls for vertical movement
                let verticalDirection = 0;
                if (Game.keysPressed[' ']) verticalDirection += 1;
                if (Game.keysPressed['shift']) verticalDirection -= 1;
                
                // Set and smooth vertical flying velocity
                const targetVerticalVel = verticalDirection * Game.player.speed;
                Game.player.velocity.y += (targetVerticalVel - Game.player.velocity.y) * 15.0 * dt;
            }

            // 2. Compute Movement Vectors
            const moveDirection = new THREE.Vector3();
            // Don't apply spacebar to forward/backward vectors if flying (used for going up instead)
            if (Game.keysPressed['w'] || Game.keysPressed['arrowup']) moveDirection.z -= 1;
            if (Game.keysPressed['s'] || Game.keysPressed['arrowdown']) moveDirection.z += 1;
            if (Game.keysPressed['a'] || Game.keysPressed['arrowleft']) moveDirection.x -= 1;
            if (Game.keysPressed['d'] || Game.keysPressed['arrowright']) moveDirection.x += 1;

            moveDirection.normalize();

            // Rotate direction matches player look horizontal rotation (yaw)
            const yaw = Game.player.rotation.y;
            const rotX = Math.sin(yaw) * moveDirection.z + Math.cos(yaw) * moveDirection.x;
            const rotZ = Math.cos(yaw) * moveDirection.z - Math.sin(yaw) * moveDirection.x;

            // Horizontal velocities
            const targetVelX = rotX * Game.player.speed;
            const targetVelZ = rotZ * Game.player.speed;

            // Simple friction/easing
            Game.player.velocity.x += (targetVelX - Game.player.velocity.x) * 12.0 * dt;
            Game.player.velocity.z += (targetVelZ - Game.player.velocity.z) * 12.0 * dt;

            // Normal ground jump handling (Only when not flying)
            if (!Game.player.flying && Game.keysPressed[' '] && Game.player.onGround) {
                Game.player.velocity.y = Game.player.jumpForce;
                Game.player.onGround = false;
            }

            // 3. Coordinate Multi-axis Box Collision checks
            const nextPos = Game.player.position.clone().addScaledVector(Game.player.velocity, dt);

            // Detect collision boundary overlaps with nearby block bounds
            const radius = Game.player.radius;
            const height = Game.player.height;

            // Define custom checks only on neighboring coordinates to ensure efficient processing
            const pxMin = Math.floor(nextPos.x - radius);
            const pxMax = Math.ceil(nextPos.x + radius);
            const pyMin = Math.floor(nextPos.y - height);
            const pyMax = Math.ceil(nextPos.y + 0.2);
            const pzMin = Math.floor(nextPos.z - radius);
            const pzMax = Math.ceil(nextPos.z + radius);

            let collidesY = false;

            // Axis independent resolution to avoid snapping through blocks
            // -- Check Y Axis movement --
            const currentPos = Game.player.position.clone();
            let finalY = nextPos.y;
            for (let x = pxMin; x <= pxMax; x++) {
                for (let y = pyMin; y <= pyMax; y++) {
                    for (let z = pzMin; z <= pzMax; z++) {
                        if (getBlockAtGlobal(x, y, z) !== BLOCK_IDS.AIR) {
                            // Check vertical box overlap
                            const boxMinY = y - 0.5;
                            const boxMaxY = y + 0.5;

                            if (currentPos.x + radius > x - 0.5 && currentPos.x - radius < x + 0.5 &&
                                currentPos.z + radius > z - 0.5 && currentPos.z - radius < z + 0.5) {
                                
                                if (Game.player.velocity.y < 0 && nextPos.y - height < boxMaxY && currentPos.y - height >= boxMaxY) {
                                    // Landed on block top!
                                    finalY = boxMaxY + height;
                                    Game.player.velocity.y = 0;
                                    Game.player.onGround = true;
                                    collidesY = true;
                                } else if (Game.player.velocity.y > 0 && nextPos.y + 0.2 > boxMinY && currentPos.y + 0.2 <= boxMinY) {
                                    // Hit ceiling block bottom!
                                    finalY = boxMinY - 0.2;
                                    Game.player.velocity.y = 0;
                                }
                            }
                        }
                    }
                }
            }

            if (!collidesY && Game.player.velocity.y !== 0) {
                Game.player.onGround = false;
            }
            
            // While flying, player is not considered "on the ground"
            if (Game.player.flying) {
                Game.player.onGround = false;
            }
            
            Game.player.position.y = finalY;

            // -- Check X Axis movement --
            let finalX = nextPos.x;
            for (let x = pxMin; x <= pxMax; x++) {
                for (let y = pyMin; y <= pyMax; y++) {
                    for (let z = pzMin; z <= pzMax; z++) {
                        if (getBlockAtGlobal(x, y, z) !== BLOCK_IDS.AIR) {
                            const boxMinX = x - 0.5;
                            const boxMaxX = x + 0.5;

                            if (Game.player.position.y + 0.2 > y - 0.5 && Game.player.position.y - height < y + 0.5 &&
                                currentPos.z + radius > z - 0.5 && currentPos.z - radius < z + 0.5) {
                                
                                if (Game.player.velocity.x > 0 && nextPos.x + radius > boxMinX && currentPos.x + radius <= boxMinX) {
                                    finalX = boxMinX - radius;
                                    Game.player.velocity.x = 0;
                                } else if (Game.player.velocity.x < 0 && nextPos.x - radius < boxMaxX && currentPos.x - radius >= boxMaxX) {
                                    finalX = boxMaxX + radius;
                                    Game.player.velocity.x = 0;
                                }
                            }
                        }
                    }
                }
            }
            Game.player.position.x = finalX;

            // -- Check Z Axis movement --
            let finalZ = nextPos.z;
            for (let x = pxMin; x <= pxMax; x++) {
                for (let y = pyMin; y <= pyMax; y++) {
                    for (let z = pzMin; z <= pzMax; z++) {
                        if (getBlockAtGlobal(x, y, z) !== BLOCK_IDS.AIR) {
                            const boxMinZ = z - 0.5;
                            const boxMaxZ = z + 0.5;

                            if (Game.player.position.y + 0.2 > y - 0.5 && Game.player.position.y - height < y + 0.5 &&
                                Game.player.position.x + radius > x - 0.5 && Game.player.position.x - radius < x + 0.5) {
                                
                                if (Game.player.velocity.z > 0 && nextPos.z + radius > boxMinZ && currentPos.z + radius <= boxMinZ) {
                                    finalZ = boxMinZ - radius;
                                    Game.player.velocity.z = 0;
                                } else if (Game.player.velocity.z < 0 && nextPos.z - radius < boxMaxZ && currentPos.z - radius >= boxMaxZ) {
                                    finalZ = boxMaxZ + radius;
                                    Game.player.velocity.z = 0;
                                }
                            }
                        }
                    }
                }
            }
            Game.player.position.z = finalZ;

            // 4. Update HUD Coordinates tracker
            document.getElementById('coordinate-display').innerText = `X: ${Game.player.position.x.toFixed(2)} | Y: ${Game.player.position.y.toFixed(2)} | Z: ${Game.player.position.z.toFixed(2)}`;

            // 5. Procedural Footstep audio logic
            const currentSpeed = Math.sqrt(Game.player.velocity.x * Game.player.velocity.x + Game.player.velocity.z * Game.player.velocity.z);
            if (Game.player.onGround && currentSpeed > 0.5) {
                if (!Game.lastStepTime) Game.lastStepTime = 0;
                const now = Date.now();
                // Play walking sound every 350ms
                if (now - Game.lastStepTime > 350) {
                    const standOnBlock = getBlockAtGlobal(Game.player.position.x, Game.player.position.y - height - 0.1, Game.player.position.z);
                    if (standOnBlock !== BLOCK_IDS.AIR) {
                        playBlockSound(standOnBlock, 'walk');
                    }
                    Game.lastStepTime = now;
                }
            }
        }

        // --- EXPORT & STORAGE INTERFACE ---

        // LocalStorage Preservation Handler
        function saveToLocalStorage(isAuto = false) {
            try {
                const saveState = {
                    modifiedBlocks: Game.modifiedBlocks,
                    playerPosition: {
                        x: Game.player.position.x,
                        y: Game.player.position.y,
                        z: Game.player.position.z
                    }
                };

                localStorage.setItem("opencraft_save", JSON.stringify(saveState));
                
                if (isAuto) {
                    showAlert("Auto-saved world!");
                } else {
                    showAlert("World state saved to Local Storage!");
                }

                // Reset trackers
                Game.dirty = false;
                Game.lastSaveTime = Date.now();
            } catch (err) {
                showAlert("Failed to save to Local Storage.");
            }
        }

        function loadFromLocalStorage() {
            try {
                const serialized = localStorage.getItem("opencraft_save");
                if (serialized) {
                    const data = JSON.parse(serialized);
                    if (data.modifiedBlocks) {
                        Game.modifiedBlocks = data.modifiedBlocks;
                        if (data.playerPosition) {
                            Game.player.position.set(data.playerPosition.x, data.playerPosition.y, data.playerPosition.z);
                        }
                        showAlert("World restored from Local Storage!");
                        return true;
                    }
                }
            } catch (err) {
                console.error("Local Storage loading failed: ", err);
            }
            return false;
        }

        // Standard direct file download logic
        function exportToJsonFile() {
            try {
                const saveState = {
                    modifiedBlocks: Game.modifiedBlocks,
                    playerPosition: {
                        x: Game.player.position.x,
                        y: Game.player.position.y,
                        z: Game.player.position.z
                    }
                };
                const jsonStr = JSON.stringify(saveState, null, 2);
                const blob = new Blob([jsonStr], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                
                const link = document.createElement("a");
                link.href = url;
                link.download = `opencraft_world_${Date.now()}.json`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);

                showAlert("JSON exported successfully!");
            } catch (err) {
                showAlert("Failed to export JSON file.");
            }
        }

        // Paused Screen Back to Menu handler
        function quitToMainMenu() {
            // Save on exit if any blocks have been placed/broken
            if (Game.dirty) {
                saveToLocalStorage(true);
            }

            // Stop auto-save checker
            if (Game.autoSaveInterval) {
                clearInterval(Game.autoSaveInterval);
                Game.autoSaveInterval = null;
            }

            // Unlock mouse Pointer Lock
            document.exitPointerLock();
            
            // Clean Three context
            if (Game.renderer) {
                Game.renderer.dispose();
                Game.renderer.domElement.remove();
                Game.renderer = null;
            }
            Game.scene = null;
            Game.camera = null;

            // Wait a brief moment to finish saving, then refresh page flawlessly
            setTimeout(() => {
                window.location.reload();
            }, 600);
        }

        // Custom notification system (replaces block level browser alert boxes)
        function showAlert(msg) {
            const alertBox = document.getElementById('game-alert');
            alertBox.innerText = msg;
            alertBox.classList.remove('opacity-0');
            alertBox.classList.add('opacity-100');

            setTimeout(() => {
                alertBox.classList.remove('opacity-100');
                alertBox.classList.add('opacity-0');
            }, 3000);
        }

        // --- ENGINE ANIMATE LOOP ---
        function animate() {
            if (!Game.scene) return; // Exit loop if quit or stopped
            
            requestAnimationFrame(animate);

            const dt = Game.clock.getDelta();

            // Run physics engine & player mechanics
            updatePlayerPhysics(dt);

            // Update chunk generation based on movement coordinates
            updateChunks(false);

            // Camera orientation updates
            const quat = new THREE.Quaternion();
            quat.setFromEuler(new THREE.Euler(Game.player.rotation.x, Game.player.rotation.y, 0, 'YXZ'));
            Game.camera.quaternion.copy(quat);
            Game.camera.position.copy(Game.player.position);

            // Trace targeting blocks
            performRaycast();

            // Render
            Game.renderer.render(Game.scene, Game.camera);
        }
