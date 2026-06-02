firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const appState = {
    trees: [{
        id: 1,
        name: "My Family Tree",
        data: {
            'root': {
                id: 'root',
                label: 'Yourself',
                firstName: '',
                surname: '',
                isFamilyName: true,
                birthDate: '',
                birthPlace: '',
                isDeceased: false,
                deathDate: '',
                deathPlace: '',
                gotParents: true,
                childrenIds: [],
                gotMarried: false,
                marriageDate: '',
                marriagePlace: ''
            },
            'root_father': {
                id: 'root_father',
                label: 'Father',
                firstName: '',
                surname: '',
                isFamilyName: true,
                birthDate: '',
                birthPlace: '',
                isDeceased: true,
                deathDate: '',
                deathPlace: '',
                gotParents: false,
                childrenIds: ['root']
            },
            'root_mother': {
                id: 'root_mother',
                label: 'Mother',
                firstName: '',
                surname: '',
                isFamilyName: false,
                birthDate: '',
                birthPlace: '',
                isDeceased: true,
                deathDate: '',
                deathPlace: '',
                gotParents: false,
                childrenIds: ['root']
            }
        }
    }],
    activeTreeId: parseInt(localStorage.getItem('activeTreeId')) || 1,
    maxGenerations: 3,
    treeCounter: 1
};

function ensureInitialSettings() {
    try {
        const key = `treeSettings:${appState.activeTreeId}`;
        const local = localStorage.getItem(key);
        if (local) {
            try {
                const s = JSON.parse(local);
                if (s.hintsLang) {
                    window.hintsLang = s.hintsLang;
                    localStorage.setItem('hintsLang', s.hintsLang);
                }
                if (s.hintsCountry) {
                    window.hintsCountry = s.hintsCountry;
                    localStorage.setItem('hintsCountry', s.hintsCountry);
                }
                if (s.maxGenerations !== undefined && s.maxGenerations !== null) {
                    appState.maxGenerations = parseInt(s.maxGenerations, 8) || appState.maxGenerations;
                }
            } catch (e) {
                console.error('Invalid local settings JSON', e);
            }
        } else {
            if (!window.hintsLang) window.hintsLang = localStorage.getItem('hintsLang') || 'pt';
            if (!window.hintsCountry) window.hintsCountry = localStorage.getItem('hintsCountry') || 'all';

            try {
                if (typeof fetchAndApplySettings === 'function') {
                    fetchAndApplySettings().catch(() => {});
                } else if (db) {
                    const id = appState.activeTreeId;
                    db.ref(`trees/${id}/settings`).once('value').then(snap => {
                        const s = snap.val();
                        if (s) cacheSettingsLocally(id, s);
                    }).catch(() => {});
                }
            } catch (e) {
                /* ignore */
            }
        }

        try {
            const slider = document.getElementById('genSlider');
            if (slider) slider.value = appState.maxGenerations;
        } catch (e) {}
        try {
            const disp = document.getElementById('genDisplay');
            if (disp) disp.innerText = appState.maxGenerations;
        } catch (e) {}
        try {
            const sel = document.getElementById('langSelect');
            if (sel && window.hintsLang) sel.value = window.hintsLang;
        } catch (e) {}
        try {
            const countrySel = document.getElementById('hints-country-select');
            if (countrySel && window.hintsCountry) countrySel.value = window.hintsCountry;
        } catch (e) {}

    } catch (e) {
        console.error('ensureInitialSettings failed', e);
    }
}


let activeNodeId = 'root';
let visualRootId = 'root';

let scale = 1;
let panX = 0;
let panY = 0;

const NODE_WIDTH = 200;
const NODE_HEIGHT = 85;
const ROW_SPACING = 95;
let computedPositions = {};
let _lastCenteredRoot = null;

const D3_TREE_CONFIG = {
    horizontalGap: NODE_WIDTH + 120,
    verticalGap: NODE_HEIGHT + ROW_SPACING + 45,
    siblingSeparation: 1.05,
    cousinSeparation: 1.3,
    junctionGap: 14
};

D3_TREE_CONFIG.lineColor = '#000000';
D3_TREE_CONFIG.lineWidth = 1.6;
D3_TREE_CONFIG.showJunctionDots = true;
D3_TREE_CONFIG.junctionDotColor = '#e67e22';
D3_TREE_CONFIG.junctionDotRadius = 6;

D3_TREE_CONFIG.showJunctionDots = false;

window.d3TreeConfig = D3_TREE_CONFIG;

function getActiveTree() {
    return appState.trees.find(t => t.id === appState.activeTreeId) || appState.trees[0];
}

function saveTreeToDatabase() {
    if (db) {
        db.ref('treesState').set(appState.trees);
    }
}

function initDatabaseListener() {
    if (db) {
        db.ref('treesState').on('value', (snapshot) => {
            const remoteTrees = snapshot.val();

            if (remoteTrees === null) {
                console.log("Database empty, initializing with defaults.");
                saveTreeToDatabase();
                return;
            }

            appState.trees = remoteTrees;

            const maxId = Math.max(...remoteTrees.map(t => t.id));
            appState.treeCounter = maxId;

            const savedId = parseInt(localStorage.getItem('activeTreeId'));
            if (appState.trees.some(t => t.id === savedId)) {
                appState.activeTreeId = savedId;
            } else {
                appState.activeTreeId = appState.trees[0].id;
                localStorage.setItem('activeTreeId', appState.activeTreeId);
            }

            updateTreeSelector();
            renderTreeCanvas();
            try {
                loadSettingsForActiveTree();
            } catch (e) {
                /* ignore */
            }
            if (activeNodeId) {
                refreshLedgerUIValuesOnly(activeNodeId);
            }
        });
    }
}

function switchTree(id) {
    appState.activeTreeId = parseInt(id);
    localStorage.setItem('activeTreeId', appState.activeTreeId);

    visualRootId = 'root';
    activeNodeId = 'root';
    renderTreeCanvas();
    openLedger('root');
    try {
        loadSettingsForActiveTree();
    } catch (e) {
        /* ignore */
    }
}

function createNewTree() {
    appState.treeCounter++;
    const nextId = appState.treeCounter;
    const newTree = {
        id: nextId,
        name: `Family Tree ${nextId}`,
        data: {
            'root': {
                id: 'root',
                label: 'Yourself',
                firstName: '',
                surname: '',
                isFamilyName: true,
                birthDate: '',
                birthPlace: '',
                isDeceased: false,
                deathDate: '',
                deathPlace: '',
                gotParents: true,
                childrenIds: [],
                gotMarried: false,
                marriageDate: '',
                marriagePlace: ''
            },
            'root_father': {
                id: 'root_father',
                label: 'Father',
                firstName: '',
                surname: '',
                isFamilyName: true,
                birthDate: '',
                birthPlace: '',
                isDeceased: true,
                deathDate: '',
                deathPlace: '',
                gotParents: false,
                childrenIds: ['root']
            },
            'root_mother': {
                id: 'root_mother',
                label: 'Mother',
                firstName: '',
                surname: '',
                isFamilyName: false,
                birthDate: '',
                birthPlace: '',
                isDeceased: true,
                deathDate: '',
                deathPlace: '',
                gotParents: false,
                childrenIds: ['root']
            }
        }
    };
    appState.trees.push(newTree);
    appState.activeTreeId = nextId;
    localStorage.setItem('activeTreeId', nextId);

    updateTreeSelector();
    switchTree(nextId);
    saveTreeToDatabase();
}

function updateTreeSelector() {
    const selector = document.getElementById('treeSelector');
    if (!selector) return;
    selector.innerHTML = '';
    appState.trees.forEach(tree => {
        const opt = document.createElement('option');
        opt.value = tree.id;
        opt.innerText = tree.name;
        opt.selected = (tree.id === appState.activeTreeId);
        selector.appendChild(opt);
    });
}

function renameActiveTree(newName) {
    const activeTree = getActiveTree();
    if (activeTree && newName.trim() !== '') {
        activeTree.name = newName;
        updateTreeSelector();
        saveTreeToDatabase();
    }
}

function updateGenDisplay(val) {
    appState.maxGenerations = parseInt(val);
    document.getElementById('genDisplay').innerText = val;
    renderTreeCanvas();
    try {
        saveSettingsToDatabase();
    } catch (e) {
        /* ignore */
    }
}

function toggleSettings() {
    const overlay = document.getElementById('settings-overlay');
    overlay.classList.toggle('hidden');
}

function extractYear(dateStr) {
    if (!dateStr) return null;
    const matches = dateStr.match(/\b\d{4}\b/);
    return matches ? parseInt(matches[0], 8) : null;
}

function calculateAgeAtDeath(bDate, dDate) {
    const birthYear = extractYear(bDate);
    const deathYear = extractYear(dDate);
    if (birthYear && deathYear && deathYear >= birthYear) {
        return deathYear - birthYear;
    }
    return null;
}

function getGenerationalLabel(idStr) {
    if (idStr === 'root') return 'Yourself';
    if (idStr.includes('_child_')) {
        return idStr.includes('_son_') ? 'Son' : 'Daughter';
    }

    let cleanId = idStr.replace(/_ph$/, '').replace(/_f_ph/g, '_father').replace(/_m_ph/g, '_mother').replace(/_father_ph$/, '_father').replace(/_mother_ph$/, '_mother');
    let parts = cleanId.split('_');
    let depth = parts.length - 1;

    let isMale = parts[parts.length - 1].includes('father');

    if (depth === 1) return isMale ? 'Father' : 'Mother';
    if (depth === 2) return isMale ? 'Grandfather' : 'Grandmother';
    if (depth === 3) return isMale ? 'Great-Grandfather' : 'Great-Grandmother';

    let dynamicIndex = depth - 2;
    let suffix = 'th';
    if (dynamicIndex === 2) suffix = 'nd';
    if (dynamicIndex === 3) suffix = 'rd';

    return `${dynamicIndex}${suffix} Great-Grandfather`;
}

function updateCurrentData() {
    const treeData = getActiveTree().data;
    const node = treeData[activeNodeId];
    if (!node || node.isPlaceholder) return;

    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    };

    const getCheck = (id) => {
        const el = document.getElementById(id);
        return el ? el.checked : false;
    };

    node.firstName = getVal('first-name');
    node.surname = getVal('surname');
    node.isFamilyName = getCheck('is-family-name');
    node.birthDate = getVal('birth-date');
    node.birthPlace = getVal('birth-place');

    node.isDeceased = getCheck('is-deceased');
    if (node.isDeceased) {
        node.deathDate = getVal('death-date');
        node.deathPlace = getVal('death-place');
    } else {
        node.deathDate = '';
        node.deathPlace = '';
    }

    node.gotMarried = getCheck('got-married');
    if (node.gotMarried) {
        node.marriageDate = getVal('marriage-date');
        node.marriagePlace = getVal('marriage-place');
    } else {
        node.marriageDate = '';
        node.marriagePlace = '';
    }

    renderTreeCanvas();
    generateSmartHints(node);
    saveTreeToDatabase();
}

function handleDeceasedToggle() {
    const isDeceased = document.getElementById('is-deceased').checked;
    document.getElementById('deceased-fields').style.display = isDeceased ? 'flex' : 'none';
    updateCurrentData();
}

function handleMarriageToggle() {
    const gotMarried = document.getElementById('got-married').checked;
    document.getElementById('marriage-inputs-container').style.display = gotMarried ? 'flex' : 'none';
    updateCurrentData();
}

function handleParentToggle() {
    const treeData = getActiveTree().data;
    const node = treeData[activeNodeId];
    if (!node || node.isPlaceholder) return;

    const gotParents = document.getElementById('got-parents').checked;
    let targetNodeToFocus = null;

    if (gotParents && (!node.fatherId || treeData[node.fatherId]?.isPlaceholder)) {
        node.fatherId = `${node.id}_father`;
        node.motherId = `${node.id}_mother`;

        treeData[node.fatherId] = {
            id: node.fatherId,
            label: getGenerationalLabel(node.fatherId),
            firstName: '',
            surname: '',
            isFamilyName: true,
            birthDate: '',
            birthPlace: '',
            isDeceased: true,
            deathDate: '',
            deathPlace: '',
            gotParents: false,
            childrenIds: [node.id]
        };
        treeData[node.motherId] = {
            id: node.motherId,
            label: getGenerationalLabel(node.motherId),
            firstName: '',
            surname: '',
            isFamilyName: false,
            birthDate: '',
            birthPlace: '',
            isDeceased: true,
            deathDate: '',
            deathPlace: '',
            gotParents: false,
            childrenIds: [node.id]
        };

        targetNodeToFocus = node.fatherId;
    } else if (!gotParents) {
        delete treeData[node.fatherId];
        delete treeData[node.motherId];
        node.fatherId = null;
        node.motherId = null;
    }

    renderTreeCanvas();
    saveTreeToDatabase();

    if (targetNodeToFocus) {
        openLedger(targetNodeToFocus);
    } else {
        updateCurrentData();
    }
}

function addNewChild(genderType) {
    const data = getActiveTree().data;
    const parentNode = data[activeNodeId];
    if (!parentNode || parentNode.isPlaceholder) return;

    if (!parentNode.childrenIds) parentNode.childrenIds = [];

    const childIndex = parentNode.childrenIds.length + 1;
    const childId = `${parentNode.id}_child_${genderType.toLowerCase()}_${childIndex}`;

    data[childId] = {
        id: childId,
        label: genderType,
        firstName: '',
        surname: parentNode.isFamilyName ? parentNode.surname : '',
        isFamilyName: true,
        birthDate: '',
        birthPlace: '',
        isDeceased: false,
        gotParents: true,
        childrenIds: []
    };

    parentNode.childrenIds.push(childId);

    renderTreeCanvas();
    refreshLedgerUIValuesOnly(activeNodeId);
    saveTreeToDatabase();
}

function removeChildNode(childId) {
    const data = getActiveTree().data;
    const parentNode = data[activeNodeId];
    if (!parentNode) return;

    parentNode.childrenIds = parentNode.childrenIds.filter(id => id !== childId);
    delete data[childId];

    renderTreeCanvas();
    refreshLedgerUIValuesOnly(activeNodeId);
    saveTreeToDatabase();
}

function openLedger(nodeId) {
    const treeData = getActiveTree().data;
    const node = treeData[nodeId];

    activeNodeId = nodeId;

    refreshLedgerUIValuesOnly(nodeId);
    centerOnNodeFully(nodeId);
}

function refreshLedgerUIValuesOnly(nodeId) {
    const treeData = getActiveTree().data;
    let node = treeData[nodeId];

    if (!node) {
        node = {
            id: nodeId,
            label: getGenerationalLabel(nodeId),
            firstName: '',
            surname: '',
            isFamilyName: false,
            birthDate: '',
            birthPlace: '',
            isDeceased: true,
            deathDate: '',
            deathPlace: '',
            gotParents: false,
            childrenIds: []
        };
    }

    document.getElementById('first-name').value = node.firstName || '';
    document.getElementById('surname').value = node.surname || '';
    document.getElementById('is-family-name').checked = node.isFamilyName;
    document.getElementById('birth-date').value = node.birthDate || '';
    document.getElementById('birth-place').value = node.birthPlace || '';
    document.getElementById('is-deceased').checked = node.isDeceased;
    document.getElementById('death-date').value = node.deathDate || '';
    document.getElementById('death-place').value = node.deathPlace || '';

    const hasRealParents = node.fatherId && treeData[node.fatherId] && !treeData[node.fatherId].isPlaceholder;
    document.getElementById('got-parents').checked = !!hasRealParents;

    const isMarriedChecked = !!node.gotMarried;
    document.getElementById('got-married').checked = isMarriedChecked;
    document.getElementById('marriage-inputs-container').style.display = isMarriedChecked ? 'flex' : 'none';
    document.getElementById('marriage-date').value = node.marriageDate || '';
    document.getElementById('marriage-place').value = node.marriagePlace || '';

    const listContainer = document.getElementById('children-list-container');
    if (listContainer) {
        listContainer.innerHTML = '';
        if (node.childrenIds && node.childrenIds.length > 0) {
            node.childrenIds.forEach(cId => {
                const childNode = treeData[cId];
                if (!childNode) return;
                const row = document.createElement('div');
                row.innerHTML = `<span style="cursor:pointer" onclick="openLedger('${cId}')">[${childNode.label}] ${childNode.firstName || 'Unnamed'}</span>`;
                listContainer.appendChild(row);
            });
        }
    }

    document.getElementById('deceased-fields').style.display = node.isDeceased ? 'flex' : 'none';
}

function centerOnNodeFully(nodeId) {
    executeFlexibleTreeLayout();
    const pos = computedPositions[nodeId];
    if (!pos) return;

    const vRect = viewport.getBoundingClientRect();
    panX = (vRect.width / 2) - (pos.x * scale);
    panY = (vRect.height / 2) - (pos.y * scale);
    updateTransform();
}

function pivotTreeFocus() {
    if (activeNodeId === visualRootId) return;
    visualRootId = activeNodeId;
    document.getElementById('back-to-root-btn').style.display = 'block';
    renderTreeCanvas();
    openLedger(visualRootId);
}

function resetTreePivot() {
    visualRootId = 'root';
    document.getElementById('back-to-root-btn').style.display = 'none';
    renderTreeCanvas();
    openLedger('root');
}

function createNodeDOM(nodeId, x, y, placeholderObj = null) {
    const treeData = getActiveTree().data;
    const node = placeholderObj || treeData[nodeId];
    if (!node) return null;

    const div = document.createElement('div');
    div.id = `node-card-${nodeId}`;

    div.style.left = x + 'px';
    div.style.top = y + 'px';

    if (node.isPlaceholder) {
        div.className = 'tree-node placeholder';
        div.innerHTML = `
            <div class="node-role">${node.label}</div>
            <div class="node-name">Unknown Parents</div>
        `;
        return div;
    }

    div.className = `tree-node ${node.id === activeNodeId ? 'active' : ''}`;

    let hasName = (node.firstName || node.surname);
    let nameDisplay = hasName ? `${node.firstName} ${node.surname}`.trim() : `Insert ${node.label}`;

    let html = `
        <div class="node-role">${node.label}</div>
        <div class="node-name">${nameDisplay}</div>
    `;

    let metaDetails = [];
    if (node.birthDate) metaDetails.push(`* b. ${node.birthDate}`);
    if (node.birthPlace) metaDetails.push(`In ${node.birthPlace}`);
    if (metaDetails.length > 0) html += `<div class="node-meta">${metaDetails.join(' ')}</div>`;

    if (node.isDeceased) {
        const age = calculateAgeAtDeath(node.birthDate, node.deathDate);
        html += `<div class="node-lifespan">† ${node.deathDate || 'Unknown'} ${age !== null ? `(aged ${age})` : ''}</div>`;
    }

    div.innerHTML = html;
    div.onclick = (e) => {
        e.stopPropagation();
        openLedger(nodeId);
    };
    return div;
}

function calculateSubtreeLayout(nodeId, gen, maxGen, state = {
    leafX: 0
}) {
    const treeData = getActiveTree().data;
    const node = treeData[nodeId];
    const isPlaceholder = !node || node.isPlaceholder;

    let fatherId = isPlaceholder ? `${nodeId}_f_ph` : (node.fatherId || `${nodeId}_father_ph`);
    let motherId = isPlaceholder ? `${nodeId}_m_ph` : (node.motherId || `${nodeId}_mother_ph`);

    if (gen >= maxGen || (!node?.fatherId && !node?.motherId)) {
        const relX = state.leafX;
        const layout = {
            subPositions: {
                [nodeId]: {
                    relX,
                    gen: gen,
                    isPlaceholder: isPlaceholder,
                    label: isPlaceholder ? getGenerationalLabel(nodeId) : node.label
                }
            }
        };
        state.leafX += NODE_WIDTH + 120;
        return layout;
    }

    const leftSubtree = calculateSubtreeLayout(fatherId, gen + 1, maxGen, state);
    const rightSubtree = calculateSubtreeLayout(motherId, gen + 1, maxGen, state);

    const fatherRelX = leftSubtree.subPositions[fatherId].relX;
    const motherRelX = rightSubtree.subPositions[motherId].relX;
    const currentRelX = (fatherRelX + motherRelX) / 2;

    let unifiedPositions = {
        ...leftSubtree.subPositions,
        ...rightSubtree.subPositions
    };

    unifiedPositions[nodeId] = {
        relX: currentRelX,
        gen: gen,
        isPlaceholder: isPlaceholder,
        label: isPlaceholder ? getGenerationalLabel(nodeId) : node.label
    };

    return {
        subPositions: unifiedPositions
    };
}

function computePerfectBinaryLayout(rootId, maxGen) {
    const treeData = getActiveTree().data;
    const subPositions = {};

    function pathInfoFromId(id) {
        if (id === rootId || id === 'root') return {
            gen: 0,
            idx: 0
        };
        const parts = id.split('_').slice(1);
        let gen = 0;
        let idx = 0;
        for (let part of parts) {
            if (!part) continue;
            const bit = part.includes('father') || part.startsWith('father') ? 0 : (part.includes('mother') || part.startsWith('mother') ? 1 : 0);
            idx = (idx << 1) | bit;
            gen++;
        }
        return {
            gen,
            idx
        };
    }

    Object.keys(treeData).forEach(id => {
        const info = pathInfoFromId(id);
        if (info.gen <= maxGen) {
            subPositions[id] = {
                relX: null,
                gen: info.gen,
                idx: info.idx,
                label: treeData[id] && treeData[id].label
            };
        }
    });

    function ensurePlaceholder(id) {
        if (!subPositions[id]) {
            const info = pathInfoFromId(id);
            if (info.gen <= maxGen) subPositions[id] = {
                relX: null,
                gen: info.gen,
                idx: info.idx,
                label: getGenerationalLabel(id)
            };
        }
    }

    function walkAndEnsure(id, gen) {
        if (gen > maxGen) return;
        ensurePlaceholder(id);
        const fatherId = `${id}_father`;
        const motherId = `${id}_mother`;
        walkAndEnsure(fatherId, gen + 1);
        walkAndEnsure(motherId, gen + 1);
    }

    walkAndEnsure(rootId, 0);

    const leafGap = NODE_WIDTH + 90;

    Object.keys(subPositions).forEach(id => {
        const entry = subPositions[id];
        const slots = Math.pow(2, entry.gen);
        const idx = entry.idx % slots;
        const offset = (idx - (slots - 1) / 2) * leafGap;
        entry.relX = offset;
    });

    return {
        subPositions
    };
}

function buildAncestorTreeNode(nodeId, gen, maxGen) {
    const treeData = getActiveTree().data;
    const node = treeData[nodeId];
    const isPlaceholder = !node || node.isPlaceholder;
    const label = isPlaceholder ? getGenerationalLabel(nodeId) : node.label;
    const builtNode = {
        id: nodeId,
        label,
        isPlaceholder,
        gen
    };

    if (gen >= maxGen) {
        return builtNode;
    }

    const fatherId = isPlaceholder ? `${nodeId}_f_ph` : (node && node.fatherId) ? node.fatherId : `${nodeId}_father`;
    const motherId = isPlaceholder ? `${nodeId}_m_ph` : (node && node.motherId) ? node.motherId : `${nodeId}_mother`;

    builtNode.children = [
        buildAncestorTreeNode(fatherId, gen + 1, maxGen),
        buildAncestorTreeNode(motherId, gen + 1, maxGen)
    ];

    return builtNode;
}

function computeD3AncestorLayout(rootId, maxGen) {
    const hierarchyData = buildAncestorTreeNode(rootId, 0, maxGen);
    const root = d3.hierarchy(hierarchyData, d => d.children);
    const treeLayout = d3.tree()
        .nodeSize([D3_TREE_CONFIG.horizontalGap, D3_TREE_CONFIG.verticalGap])
        .separation((a, b) => (a.parent === b.parent ? D3_TREE_CONFIG.siblingSeparation : D3_TREE_CONFIG.cousinSeparation));
    treeLayout(root);

    const rootX = root.x;
    const rootY = root.y;

    const subPositions = {};
    root.descendants().forEach(node => {
        subPositions[node.data.id] = {
            relX: node.x - rootX,
            relY: -(node.y - rootY),
            gen: node.depth,
            isPlaceholder: !!node.data.isPlaceholder,
            label: node.data.label
        };
    });

    return {
        subPositions
    };
}

function executeFlexibleTreeLayout() {
    computedPositions = {};
    const layoutStructure = computeD3AncestorLayout(visualRootId, appState.maxGenerations);

    Object.keys(layoutStructure.subPositions).forEach(k => {
        const relData = layoutStructure.subPositions[k];
        computedPositions[k] = {
            x: relData.relX,
            y: relData.relY,
            gen: relData.gen,
            isPlaceholder: relData.isPlaceholder,
            label: relData.label
        };
    });
}

function createWrappedSvgText(svg, x, y, text, maxWidth, fontSize = 11, lineHeight = 14) {
    if (!text || text.trim() === '') return null;
    const ns = 'http://www.w3.org/2000/svg';
    const textEl = document.createElementNS(ns, 'text');
    textEl.setAttribute('x', x);
    textEl.setAttribute('y', y);
    textEl.setAttribute('fill', '#1a303a');
    textEl.setAttribute('font-size', fontSize);
    textEl.setAttribute('font-family', 'Segoe UI, Roboto, Helvetica, Arial, sans-serif');
    textEl.setAttribute('text-anchor', 'middle');
    svg.appendChild(textEl);

    const words = text.split(/\s+/);
    let line = '';
    let tspan = document.createElementNS(ns, 'tspan');
    tspan.setAttribute('x', x);
    tspan.setAttribute('dy', '0');
    textEl.appendChild(tspan);

    for (let i = 0; i < words.length; i++) {
        const testLine = line ? (line + ' ' + words[i]) : words[i];
        tspan.textContent = testLine;

        if (textEl.getComputedTextLength() > maxWidth && line !== '') {
            tspan.textContent = line;
            tspan = document.createElementNS(ns, 'tspan');
            tspan.setAttribute('x', x);
            tspan.setAttribute('dy', lineHeight);
            tspan.textContent = words[i];
            textEl.appendChild(tspan);
            line = words[i];
        } else {
            line = testLine;
            tspan.textContent = line;
        }
    }

    return textEl;
}

function getNodeMetrics(nodeId) {
    const card = document.getElementById(`node-card-${nodeId}`);
    if (card) {
        return {
            width: card.offsetWidth || NODE_WIDTH,
            height: card.offsetHeight || NODE_HEIGHT
        };
    }

    const styles = getComputedStyle(document.documentElement);
    const cssWidth = parseFloat(styles.getPropertyValue('--node-width')) || NODE_WIDTH;
    const cssHeight = parseFloat(styles.getPropertyValue('--node-height')) || NODE_HEIGHT;

    return {
        width: cssWidth,
        height: Number.isFinite(cssHeight) ? cssHeight : NODE_HEIGHT
    };
}

function appendSvgPath(svg, d, strokeWidth = 2.4) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', D3_TREE_CONFIG.lineColor || '#1a303a');
    path.setAttribute('stroke-width', D3_TREE_CONFIG.lineWidth || strokeWidth);
    path.setAttribute('stroke-opacity', '1');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return path;
}

function appendSvgCircle(svg, cx, cy, r, fill) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', cx);
    c.setAttribute('cy', cy);
    c.setAttribute('r', r);
    c.setAttribute('fill', fill || D3_TREE_CONFIG.junctionDotColor || '#e67e22');
    c.setAttribute('stroke', '#ffffff');
    c.setAttribute('stroke-width', '1');
    svg.appendChild(c);
    return c;
}

function drawSolidLines(positions, vLeft, vRight, vTop, vBottom) {
    const svg = document.getElementById('tree-connections');
    if (!svg) return;
    svg.innerHTML = '';

    const nodesContainer = document.getElementById('nodes-container');
    if (nodesContainer) {
        const oldLabels = nodesContainer.querySelectorAll('.marriage-label');
        oldLabels.forEach(l => l.remove());
    }

    const treeData = getActiveTree().data;

    Object.keys(positions).forEach(id => {
        const currentPos = positions[id];
        if (!currentPos) return;
        if (currentPos.gen >= appState.maxGenerations) return;
        const node = treeData[id];
        const isPosPlaceholder = currentPos.isPlaceholder;

        let fatherId, motherId;
        if (isPosPlaceholder) {
            fatherId = `${id}_f_ph`;
            motherId = `${id}_m_ph`;
        } else {
            fatherId = node && node.fatherId ? node.fatherId : `${id}_father`;
            motherId = node && node.motherId ? node.motherId : `${id}_mother`;
        }

        if (!fatherId || !motherId) return;

        const fatherPos = positions[fatherId];
        const motherPos = positions[motherId];

        if (!fatherPos || !motherPos) return;
        if (fatherPos.gen >= appState.maxGenerations || motherPos.gen >= appState.maxGenerations) return;

        const childMetrics = getNodeMetrics(id);
        const fatherMetrics = getNodeMetrics(fatherId);
        const motherMetrics = getNodeMetrics(motherId);

        const childTop = currentPos.y - (childMetrics.height / 2);
        const fatherBottom = fatherPos.y + (fatherMetrics.height / 2);
        const motherBottom = motherPos.y + (motherMetrics.height / 2);

        const startYOffset = 2;
        const endYOffset = 2;

        const fatherStartX = fatherPos.x;
        const fatherStartY = fatherBottom + startYOffset;
        const motherStartX = motherPos.x;
        const motherStartY = motherBottom + startYOffset;

        const childEndX = currentPos.x;
        const childEndY = childTop - endYOffset;

        const midY = fatherStartY < motherStartY ? Math.min(fatherStartY, motherStartY) + Math.abs(childEndY - Math.min(fatherStartY, motherStartY)) * 0.5 : (fatherStartY + childEndY) / 2;

        const fatherPath = `M ${fatherStartX} ${fatherStartY} L ${fatherStartX} ${midY} L ${childEndX} ${midY} L ${childEndX} ${childEndY}`;
        appendSvgPath(svg, fatherPath);

        const motherPath = `M ${motherStartX} ${motherStartY} L ${motherStartX} ${midY} L ${childEndX} ${midY} L ${childEndX} ${childEndY}`;
        appendSvgPath(svg, motherPath);

    });
}

function ensureConnectorsOverlay() {
    let overlay = document.getElementById('connectors-overlay');
    const canvasEl = document.getElementById('canvas');
    if (!canvasEl) return null;
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'connectors-overlay';
        overlay.style.position = 'absolute';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '9';
        canvasEl.appendChild(overlay);
    }
    return overlay;
}

function clearConnectorsOverlay() {
    const overlay = document.getElementById('connectors-overlay');
    if (!overlay) return;
    overlay.innerHTML = '';
}

function drawHtmlConnectors(positions) {
    const overlay = ensureConnectorsOverlay();
    if (!overlay) return;
    overlay.innerHTML = '';

    const treeData = getActiveTree().data;

    Object.keys(positions).forEach(id => {
        const currentPos = positions[id];
        if (!currentPos) return;
        if (currentPos.gen >= appState.maxGenerations) return;
        const node = treeData[id];
        const isPosPlaceholder = currentPos.isPlaceholder;

        let fatherId, motherId;
        if (isPosPlaceholder) {
            fatherId = `${id}_f_ph`;
            motherId = `${id}_m_ph`;
        } else {
            fatherId = node && node.fatherId ? node.fatherId : `${id}_father`;
            motherId = node && node.motherId ? node.motherId : `${id}_mother`;
        }

        if (!fatherId || !motherId) return;

        const fatherPos = positions[fatherId];
        const motherPos = positions[motherId];
        if (!fatherPos || !motherPos) return;
        if (fatherPos.gen >= appState.maxGenerations || motherPos.gen >= appState.maxGenerations) return;

        const childMetrics = getNodeMetrics(id);
        const fatherMetrics = getNodeMetrics(fatherId);
        const motherMetrics = getNodeMetrics(motherId);

        const childTop = currentPos.y - (childMetrics.height / 2);
        const fatherBottom = fatherPos.y + (fatherMetrics.height / 2);
        const motherBottom = motherPos.y + (motherMetrics.height / 2);

        const fatherStart = {
            x: fatherPos.x,
            y: fatherBottom
        };
        const motherStart = {
            x: motherPos.x,
            y: motherBottom
        };
        const childEnd = {
            x: currentPos.x,
            y: childTop
        };

        const midY = Math.min(fatherStart.y, motherStart.y) + Math.abs(childEnd.y - Math.min(fatherStart.y, motherStart.y)) * 0.5;

        function makeSegment(start, end) {
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            const line = document.createElement('div');
            line.className = 'connector-line';
            line.style.position = 'absolute';
            line.style.left = `${start.x}px`;
            line.style.top = `${start.y - (D3_TREE_CONFIG.lineWidth/2)}px`;
            line.style.width = `${len}px`;
            line.style.height = `${D3_TREE_CONFIG.lineWidth}px`;
            line.style.background = D3_TREE_CONFIG.lineColor || '#000000';
            line.style.transformOrigin = '0 50%';
            line.style.transform = `rotate(${angle}deg)`;
            line.style.borderRadius = `${D3_TREE_CONFIG.lineWidth}px`;
            overlay.appendChild(line);
        }

        makeSegment(fatherStart, {
            x: fatherStart.x,
            y: midY
        });
        makeSegment(motherStart, {
            x: motherStart.x,
            y: midY
        });
        makeSegment({
            x: fatherStart.x,
            y: midY
        }, {
            x: childEnd.x,
            y: midY
        });
        makeSegment({
            x: motherStart.x,
            y: midY
        }, {
            x: childEnd.x,
            y: midY
        });
        makeSegment({
            x: childEnd.x,
            y: midY
        }, childEnd);
    });
}




function renderTreeCanvas() {
    const nodesContainer = document.getElementById('nodes-container');
    if (!nodesContainer) return;
    executeFlexibleTreeLayout();

    const styles = getComputedStyle(document.documentElement);
    const nWidth = parseInt(styles.getPropertyValue('--node-width')) || 200;
    const nHeight = parseInt(styles.getPropertyValue('--node-height')) || 85;

    const vRect = viewport.getBoundingClientRect();
    const padding = 250;
    const visibleLeft = (-panX / scale) - padding;
    const visibleRight = ((-panX + vRect.width) / scale) + padding;
    const visibleTop = (-panY / scale) - padding;
    const visibleBottom = ((-panY + vRect.height) / scale) + padding;

    const activeElements = {};

    Object.keys(computedPositions).forEach(id => {
        const pos = computedPositions[id];
        if (!pos) return;
        if (pos.gen >= appState.maxGenerations) return;
        activeElements[id] = true;
        let existingCard = document.getElementById(`node-card-${id}`);

        let nodeDOM = pos.isPlaceholder ?
            createNodeDOM(id, pos.x, pos.y, {
                id: id,
                label: pos.label,
                isPlaceholder: true
            }) :
            createNodeDOM(id, pos.x, pos.y);

        if (nodeDOM) {
            if (!existingCard) {
                nodesContainer.appendChild(nodeDOM);
            } else {
                nodesContainer.replaceChild(nodeDOM, existingCard);
            }
        }
    });

    const childCards = nodesContainer.querySelectorAll('.tree-node');
    childCards.forEach(card => {
        const cardId = card.id.replace('node-card-', '');
        if (!activeElements[cardId]) {
            card.remove();
        }
    });

    drawSolidLines(computedPositions, visibleLeft, visibleRight, visibleTop, visibleBottom);
    try {
        drawHtmlConnectors(computedPositions);
    } catch (e) {
        console.error('Error drawing HTML connectors:', e);
    }

    if (_lastCenteredRoot !== visualRootId) {
        _lastCenteredRoot = visualRootId;
        const rootPos = computedPositions[visualRootId];
        if (rootPos) {
            const vRect2 = viewport.getBoundingClientRect();
            panX = (vRect2.width / 2) - (rootPos.x * scale);
            panY = (vRect2.height / 2) - (rootPos.y * scale);
            canvas.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;
            const zi = document.getElementById('zoom-indicator');
            if (zi) zi.innerText = `Zoom: ${Math.round(scale * 100)}%`;
        }
    }
}

const viewport = document.getElementById('viewport');
const canvas = document.getElementById('canvas');
let isDragging = false;
let startX, startY;

viewport.addEventListener('mousedown', (e) => {
    const clickedNode = e.target.closest('.tree-node');
    if (clickedNode) {
        const id = clickedNode.id.replace('node-card-', '');
        openLedger(id);
        return;
    }

    isDragging = true;
    canvas.classList.add('dragging');
    startX = e.clientX - panX;
    startY = e.clientY - panY;
});

window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    updateTransform(true);
});

window.addEventListener('mouseup', () => {
    isDragging = false;
    canvas.classList.remove('dragging');
    renderTreeCanvas();
});

viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    canvas.classList.add('dragging');
    const intensity = 0.08;
    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const canvasMouseX = (mouseX - panX) / scale;
    const canvasMouseY = (mouseY - panY) / scale;

    if (e.deltaY < 0) scale += scale * intensity;
    else scale -= scale * intensity;

    scale = Math.max(0.01, Math.min(3.0, scale));
    panX = mouseX - canvasMouseX * scale;
    panY = mouseY - canvasMouseY * scale;
    updateTransform(false);
    setTimeout(() => canvas.classList.remove('dragging'), 50);
});

function updateTransform(isDraggingPan = false) {
    canvas.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;
    document.getElementById('zoom-indicator').innerText = `Zoom: ${Math.round(scale * 100)}%`;
    if (!isDraggingPan) {
        renderTreeCanvas();
    }
}

function generateSmartHints(node) {
    const hintsContainer = document.getElementById('hints-container');
    if (!hintsContainer) return;
    hintsContainer.innerHTML = '';
    const locationStr = (node && node.birthPlace) ? node.birthPlace.toLowerCase() : '';
    const birthYear = node ? extractYear(node.birthDate) : null;
    const lang = window.hintsLang || localStorage.getItem('hintsLang') || 'pt';
    const effectiveLang = (lang === 'pt') ? 'pt' : 'en';

    function wrap(partsArr) {
        return partsArr.join('\n');
    }

    if (['es', 'gl', 'ca', 'eu'].includes(lang)) {
        const detectedCountries = detectCountriesInTree();
        const selectedCountry = window.hintsCountry || localStorage.getItem('hintsCountry') || 'pt';
        const i18n = {
            es: {
                startPriority: 'Empieza en casa',
                askFamilyTitle: 'Habla con tu familia',
                askFamilyText: 'Habla con tus abuelos, tíos y familiares mayores. Pregunta por nombres completos, apodos, fechas aproximadas y lugares clave. Pregunta también por recuerdos concretos: esos detalles suelen desbloquear fechas, lugares y vínculos familiares.',
                orderPriority: 'Orden',
                orderTitle: 'Que registro pedir primero',
                orderText: 'Depende de lo que ya sabes. Muchas veces conviene empezar por un nacimiento, pero si tienes buenas pistas sobre el matrimonio de los padres, empieza por ahí.',
                onlinePriority: 'Búsqueda online',
                onlineTitle: 'Registros de personas fallecidas',
                onlineText: 'Si la persona ya falleció, busca en FamilySearch y Geneall. Te pueden ahorrar mucho tiempo en la investigación.',
                immediatePriority: 'Paso inmediato',
                immediateTitle: 'Escribe al menos un nombre',
                immediateText: 'Añade al menos un nombre o apellido para activar sugerencias de búsqueda más específicas.',
                historyPriority: 'Contexto histórico',
                historyTitle: 'Periodo complicado',
                historyText: 'Los registros de esta época pueden tener lagunas por la Guerra Peninsular. Si faltan documentos, no significa que estés buscando mal.',
                resourcesPriority: 'Enlaces rápidos',
                resourcesTitle: 'Recursos',
                checklistBtn: 'Descargar checklist',
                spPriority: 'España',
                spTitle: 'Registros en España',
                linksLabel: 'Enlaces útiles'
            },
            gl: {
                startPriority: 'Comeza na casa',
                askFamilyTitle: 'Fala coa túa familia',
                askFamilyText: 'Fala cos teus avós, tíos e familiares maiores. Pregunta por nomes completos, alcumes, datas aproximadas e lugares clave. Pregunta tamén por lembranzas concretas: eses detalles adoitan axudar a atopar datas, lugares e ligazóns familiares.',
                orderPriority: 'Orde',
                orderTitle: 'Que rexistro pedir primeiro',
                orderText: 'Depende do que xa sabes. Moitas veces compensa comezar cun nacemento, pero se tes boas pistas sobre o matrimonio dos pais, empeza por aí.',
                onlinePriority: 'Busca en liña',
                onlineTitle: 'Rexistros de persoas falecidas',
                onlineText: 'Se a persoa xa faleceu, busca en FamilySearch e Geneall. Pódenche aforrar moito tempo na investigación.',
                immediatePriority: 'Paso inmediato',
                immediateTitle: 'Escribe polo menos un nome',
                immediateText: 'Engade polo menos un nome ou apelido para activar suxestións de busca máis específicas.',
                historyPriority: 'Contexto histórico',
                historyTitle: 'Período complicado',
                historyText: 'Os rexistros desta época poden ter lagoas pola Guerra Peninsular. Se faltan documentos, non significa que esteas buscando mal.',
                resourcesPriority: 'Ligazóns rápidas',
                resourcesTitle: 'Recursos',
                checklistBtn: 'Descargar checklist',
                spPriority: 'España',
                spTitle: 'Rexistros en España',
                linksLabel: 'Ligazóns útiles'
            },
            ca: {
                startPriority: 'Comença a casa',
                askFamilyTitle: 'Parla amb la teva família',
                askFamilyText: 'Parla amb els teus avis, oncles i familiars grans. Pregunta per noms complets, malnoms, dates aproximades i llocs clau. Demana també records concrets: aquests detalls sovint t\'ajuden a trobar dates, llocs i vincles familiars.',
                orderPriority: 'Ordre',
                orderTitle: 'Quin registre demanar primer',
                orderText: 'Depèn del que ja saps. Sovint convé començar per un naixement, però si tens bones pistes del matrimoni dels pares, comença per aquí.',
                onlinePriority: 'Recerca en línia',
                onlineTitle: 'Registres de persones difuntes',
                onlineText: 'Si la persona ja és difunta, busca a FamilySearch i Geneall. Et poden estalviar molt de temps de recerca.',
                immediatePriority: 'Pas immediat',
                immediateTitle: 'Escriu com a mínim un nom',
                immediateText: 'Afegeix com a mínim un nom o cognom per activar suggeriments de recerca més específics.',
                historyPriority: 'Context històric',
                historyTitle: 'Període complicat',
                historyText: 'Els registres d\'aquesta època poden tenir buits per la Guerra del Francès. Si falten documents, no vol dir que ho facis malament.',
                resourcesPriority: 'Enllaços ràpids',
                resourcesTitle: 'Recursos',
                checklistBtn: 'Descarrega checklist',
                spPriority: 'Espanya',
                spTitle: 'Registres a Espanya',
                linksLabel: 'Enllaços útils'
            },
            eu: {
                startPriority: 'Etxetik hasi',
                askFamilyTitle: 'Hitz egin zure familiarekin',
                askFamilyText: 'Hitz egin zure aitona-amonekin, osaba-izebekin eta adineko senideekin. Galdetu izen-abizen osoak, goitizenak, gutxi gorabeherako datak eta leku garrantzitsuak. Oroitzapen zehatzak ere galdetu: xehetasun horiek askotan datak, lekuak eta lotura familiarrak argitzen dituzte.',
                orderPriority: 'Ordena',
                orderTitle: 'Zein erregistro eskatu lehenengo',
                orderText: 'Dagoeneko dakizunaren araberakoa da. Askotan jaiotza-erregistroarekin hastea komeni da; baina gurasoen ezkontzari buruz pista onak badituzu, hortik hasi.',
                onlinePriority: 'Online bilaketa',
                onlineTitle: 'Hildako pertsonen erregistroak',
                onlineText: 'Pertsona hil bada, bilatu FamilySearch eta Geneall guneetan. Denbora asko aurrez diezazukete ikerketan.',
                immediatePriority: 'Berehalako urratsa',
                immediateTitle: 'Idatzi gutxienez izen bat',
                immediateText: 'Gehitu gutxienez izen edo abizen bat bilaketa-iradokizun zehatzagoak aktibatzeko.',
                historyPriority: 'Testuinguru historikoa',
                historyTitle: 'Garai konplikatua',
                historyText: 'Garai honetako erregistroek hutsuneak izan ditzakete Penintsulako Gerragatik. Dokumentuak falta badira, ez du esan nahi gaizki ari zarenik.',
                resourcesPriority: 'Esteka azkarrak',
                resourcesTitle: 'Baliabideak',
                checklistBtn: 'Deskargatu checklist-a',
                spPriority: 'Espainia',
                spTitle: 'Espainiako erregistroak',
                linksLabel: 'Esteka erabilgarriak'
            }
        };
        const t = i18n[lang] || i18n.es;
        const parts = [];

        parts.push(`
            <div class="hint-box">
                <span class="hint-priority">${t.startPriority}</span>
                <h4>${t.askFamilyTitle}</h4>
                <p>${t.askFamilyText}</p>
            </div>
        `);

        parts.push(`
            <div class="hint-box">
                <span class="hint-priority">${t.orderPriority}</span>
                <h4>${t.orderTitle}</h4>
                <p>${t.orderText}</p>
            </div>
        `);

        if (!node.firstName && !node.surname) {
            parts.push(`
                <div class="hint-box">
                    <span class="hint-priority">${t.immediatePriority}</span>
                    <h4>${t.immediateTitle}</h4>
                    <p>${t.immediateText}</p>
                </div>
            `);
        } else {
            parts.push(`
                <div class="hint-box">
                    <span class="hint-priority">${t.onlinePriority}</span>
                    <h4>${t.onlineTitle}</h4>
                    <p>${t.onlineText}</p>
                </div>
            `);
        }

        if (birthYear && (birthYear >= 1807 && birthYear <= 1814)) {
            parts.push(`
                <div class="hint-box">
                    <span class="hint-priority">${t.historyPriority}</span>
                    <h4>${t.historyTitle}</h4>
                    <p>${t.historyText}</p>
                </div>
            `);
        }

        if (detectedCountries.includes('es') && selectedCountry === 'es') {
            const sp = {
                es: 'El registro civil moderno en España empezó en 1871; antes, los asientos suelen estar en libros parroquiales. Para pedir actas, contacta con el Registro Civil local o con el archivo municipal. Muchos registros están digitalizados en PARES y FamilySearch. Identifica municipio/parroquia y referencia del libro, pide una copia simple para genealogía e incluye nombres completos, fechas, nombres de los padres y tu parentesco.',
                gl: 'O rexistro civil moderno en España comezou en 1871; antes, os asentos adoitan estar nos libros parroquiais. Para pedir actas, contacta co Rexistro Civil local ou co arquivo municipal. Moitos rexistros están dixitalizados en PARES e FamilySearch. Identifica concello/parroquia e referencia do libro, solicita unha copia simple para xenealoxía e inclúe nomes completos, datas, nomes dos pais e o teu parentesco.',
                ca: 'El registre civil modern a Espanya va començar el 1871; abans, els assentaments solen estar als llibres parroquials. Per demanar actes, contacta amb el Registro Civil local o amb l\'arxiu municipal. Molts registres estan digitalitzats a PARES i FamilySearch. Identifica municipi/parròquia i referència del llibre, demana una còpia simple per a genealogia i inclou noms complets, dates, noms dels pares i el teu parentiu.',
                eu: 'Espainiako erregistro zibil modernoa 1871n hasi zen; aurretik, idazpenak parrokiako liburuetan egoten dira normalean. Agiriak eskatzeko, jarri harremanetan tokiko Registro Civil bulegoarekin edo udal artxiboarekin. Erregistro asko digitalizatuta daude PARES eta FamilySearch-en. Identifikatu udalerria/parrokia eta liburuaren erreferentzia, eskatu kopia sinplea genealogiarako eta gehitu izen-abizen osoak, datak, gurasoen izenak eta zure senidetasuna.'
            };
            parts.push(`
                <div class="hint-box">
                    <span class="hint-priority">${t.spPriority}</span>
                    <h4>${t.spTitle}</h4>
                    <p>${sp[lang] || sp.es}</p>
                    <p style="margin-top:8px; font-weight:600;">${t.linksLabel}:</p>
                    <p><a href="https://pares.culturaydeporte.gob.es">PARES</a> · <a href="https://sede.mjusticia.gob.es/es/servicios/registro-civil">Registro Civil (Ministerio)</a> · <a href="https://www.familysearch.org/">FamilySearch</a></p>
                </div>
            `);
        }

        parts.push(`
            <div class="hint-box">
                <span class="hint-priority">${t.resourcesPriority}</span>
                <h4>${t.resourcesTitle}</h4>
                <p><a href="https://www.familysearch.org/">FamilySearch</a> · <a href="https://geneall.net/pt/">Geneall</a> · <a href="https://pares.culturaydeporte.gob.es">PARES</a></p>
                <div style="margin-top:8px; display:flex; gap:8px;"><button class="hud-btn" onclick="generateChecklistDownload()">${t.checklistBtn}</button></div>
            </div>
        `);

        hintsContainer.innerHTML = wrap(parts);
        return;
    }

    if (effectiveLang === 'en') {
        const en = [];
        const detectedCountries = detectCountriesInTree();
        const selectedCountry = window.hintsCountry || localStorage.getItem('hintsCountry') || 'all';
        en.push(`
            <div class="hint-box">
                <span class="hint-priority">Start at home</span>
                <h4>Ask the family</h4>
                <p>Talk to your grandparents, aunts, uncles or other older family members. The most important part is to ask about their parents and grandparents, and also about the parents and grandparents from other branches of your direct ancestry. Ask for full names, nicknames, approximate dates and places. Ask about memories that marked that person in particular, because those details often unlock dates, places, and family links, and they are valuable historical material. While someone is sharing these memories, it can also help to record the conversation as an option, and you can always adjust your notes later.</p>
            </div>
        `);

        if (selectedCountry === 'all' || selectedCountry === 'pt') {
            en.push(`
                <div class="hint-box">
                    <span class="hint-priority">Request records by email</span>
                    <h4>Civil registries: cost and where to send</h4>
                    <p>Reports can usually be requested by email for only around €1 to €2 each. To ensure your request is sent to the correct CRO (Civil Registry Office), please check the concelho and freguesia. If you are abroad or would simply prefer not to travel there, email is usually the simplest option. Make sure your email is detailed enough to provide all the necessary information (birth place, birth date, parents, etc.), but not overly detailed, to ensure a quick response from the CRO.</p>
                </div>
            `);
        }

        if (selectedCountry === 'all' || selectedCountry === 'pt') {
            en.push(`
                <div class="hint-box">
                    <span class="hint-priority">Where to look</span>
                    <h4>Civil registries (from 1911) or parish books (before 1911)</h4>
                    <p>Use <a href="https://tombo.pt/">tombo.pt</a> to find parish books and more information about your relatives. For newer records check CRCs or Civil Online.</p>
                </div>
            `);
        }

        en.push(`
            <div class="hint-box">
                <span class="hint-priority">Order</span>
                <h4>Which records first</h4>
                <p>The best order depends on what you already know. Most people start with a birth record, but if your strongest clues point to a parents' marriage record, start there.</p>
            </div>
        `);

        if (selectedCountry === 'all' || selectedCountry === 'pt') {
            en.push(`
                <div class="hint-box">
                    <span class="hint-priority">How to use Tombo</span>
                    <h4>Quick steps</h4>
                    <p>Go to <a href="https://tombo.pt/">tombo.pt</a> → search by municipality/parish → view the list of available books → click on the link for the relevant book, depending on the time period → view more information about your ancestors. I recommend that you transcribe all the links and the exact text of each record you consulted for your research into a notes document using the Portuguese spelling of the time, so that you can compile your sources and not miss any details.</p>
                </div>
            `);
        }

        if (selectedCountry === 'all' || selectedCountry === 'pt') {
            en.push(`
                <div class="hint-box">
                    <span class="hint-priority">Quick links</span>
                    <h4>Resources</h4>
                    <p><a href="https://www.civilonline.mj.pt/CivilOnline/Certida/">Civil Online</a> · <a href="https://tombo.pt/">Tombo.pt</a> · <a href="https://www.familysearch.org/">FamilySearch</a></p>
                    <div style="margin-top:8px; display:flex; gap:8px;"><button class="hud-btn" onclick="generateChecklistDownload()">Download checklist</button></div>
                </div>
            `);
        }

        if (detectedCountries.includes('es') && (selectedCountry === 'all' || selectedCountry === 'es')) {
            const uiLang = lang;
            const sp = {
                en: '<p><strong>English:</strong> Modern civil registration in Spain began in 1871; earlier entries are usually found in parish registers. To request civil records, contact the local <em>Registro Civil</em> or the municipal archive. Many records have been digitised on PARES (Portal de Archivos Españoles) and on FamilySearch. Practical steps: identify the municipality/parish and the book reference, ask for a <em>copia simple</em> for genealogical purposes, include full names, dates, parents\' names and your relationship, and check local fees and accepted payment methods.</p>',
                es: '<p><strong>Español:</strong> El registro civil moderno en España se implantó a partir de 1871; antes, la mayoría de los asientos aparecen en libros parroquiales. Para solicitar actas, contacte con el <em>Registro Civil</em> local o con el archivo municipal. Muchos registros están digitalizados en PARES y en FamilySearch. Pasos prácticos: identifique municipio/parroquia y referencia del libro; solicite una "copia simple" para fines genealógicos; incluya nombres completos, fechas, nombres de los padres y grado de parentesco; compruebe las tasas y formas de pago.</p>',
                gl: '<p><strong>Galego:</strong> O rexistro civil moderno en España comezou en 1871; antes, os asentos están normalmente nos libros parroquiais. Para solicitar actas, contacte co Rexistro Civil local ou co arquivo municipal. Moitos rexistros están dixitalizados en PARES e FamilySearch. Pasos: identifique o concello/parroquia e a referencia do libro; solicite unha "copia simple" para fins xenealóxicos; inclúa nomes completos, datas, nomes dos pais e grao de parentesco; comprobe taxas e formas de pagamento.</p>',
                ca: '<p><strong>Català:</strong> El registre civil modern a Espanya va començar el 1871; abans, els asents solen trobar‑se en llibres parroquials. Per sol·licitar actes, poseu‑vos en contacte amb el <em>Registro Civil</em> local o l\'arxiu municipal. Molts registres estan digitalitzats a PARES i a FamilySearch. Passos pràctics: identifiqueu el municipi/parròquia i la referència del llibre; sol·liciteu una "còpia simple" per a finalitats genealògiques; incloeu noms complets, dates, noms dels pares i nivell de parentiu; comproveu taxes i mètodes de pagament.</p>',
                eu: '<p><strong>Euskara (Basque):</strong> Espainiako errolda modernoak 1871ean hasi ziren; aurreko erregistro gehienak eliz-parrokiako liburuetan daude. Aktak eskatzeko, jarri harremanetan tokiko <em>Registro Civil</em> edo udal artxiboarekin. Erregistro askok PARES eta FamilySearch guneetan daude digitalizatuta. Pauso praktikoak: identifikatu udalerri/parrokia eta liburuaren erreferentzia; eskatu <em>copia simple</em> genealogiarako; eman izen osoak, datak, gurasoen izenak eta senidetza‑maila; egiaztatu tasak eta ordainketa‑moduak.</p>'
            };
            let bodyHtml = '';
            if (['en', 'es', 'gl', 'ca', 'eu'].includes(uiLang)) {
                bodyHtml = sp[uiLang];
            } else {
                bodyHtml = sp.en + sp.es + sp.gl + sp.ca + sp.eu;
            }
            en.push(`
                <div class="hint-box">
                    <span class="hint-priority">Spain/España</span>
                    <h4>Records overview</h4>
                    ${bodyHtml}
                    <p style="margin-top:8px; font-weight:600;">Useful links / Enlaces / Ligazóns:</p>
                    <p><a href="https://pares.culturaydeporte.gob.es">PARES (Portal de Archivos Españoles)</a> · <a href="https://sede.mjusticia.gob.es/es/servicios/registro-civil">Registro Civil (Ministerio de Justicia)</a> · <a href="https://www.familysearch.org/">FamilySearch</a></p>
                </div>
            `);
        }

        if (selectedCountry === 'all' || selectedCountry === 'pt') {
            en.push(`
                <div class="hint-box">
                    <span class="hint-priority">Request records (sample email)</span>
                    <h4>Subject translated; body in Portuguese (placeholders in English)</h4>
                    <pre style="white-space:pre-wrap; background:#fbfbfb; padding:10px; border-radius:6px; border:1px solid #eee; font-size:13px; line-height:1.4;">Subject: Pedido de cópia de registo de [CHOOSE ONE: baptism (write "batismo"), marriage (write "casamento") or death (write "óbito")] para fins genealógicos.

Email body:

Exmos. Senhores,

Chamo‑me [INSERT YOUR FULL NAME] e solicito uma cópia simples não autenticada do registo de [WHAT YOU ARE REQUESTING] de [TARGET PERSON/PEOPLE AND YOUR RELATIONSHIP TO THEM].
[TARGET PERSON/PEOPLE], [CHOOSE: son/daughter or children] of [PARENT(S) OF THE TARGET PERSON/PEOPLE], [BORN/MARRIED/DIED AS APPROPRIATE] on [INSERT DATE], in [INSERT LOCATION OR AT LEAST THE PARISH (OR THE MUNICIPALITY IF YOU DON'T KNOW THE PARISH)].
Solicito todos os detalhes disponíveis no registo, incluindo a(s) filiação/ões completa(s), naturalidade(s), profissão/ões e outra(s) informação/ões presente(s).
Tratando‑se de um pedido para fins genealógicos sem efeitos legais ou administrativos, solicito uma cópia simples não autenticada, caso esteja disponível, por ter custo inferior à certidão autenticada.
Agradeço que me informem sobre o procedimento necessário, incluindo o custo associado e a forma de pagamento aceite.
Fico disponível para fornecer quaisquer informações adicionais necessárias.

Agradeço antecipadamente a vossa atenção.

Com os melhores cumprimentos,

[INSERT YOUR FULL NAME]</pre>
                </div>
            `);
        }

        hintsContainer.innerHTML = wrap(en);
        return;
    }

    const parts = [];
    const detectedCountries = detectCountriesInTree();
    const selectedCountry = window.hintsCountry || localStorage.getItem('hintsCountry') || 'all';

    parts.push(`
        <div class="hint-box">
            <span class="hint-priority">Começa por casa</span>
            <h4>Fala com a tua família</h4>
            <p>Conversa com os teus avós, tios, tias e outros familiares mais velhos. O mais importante é fazer perguntas aos teus pais e avós, e também aos pais e avós dos teus outros familiares diretos. Regista o nome completo, as alcunhas, a data aproximada e os locais importantes. Pergunta também sobre memórias que tenham marcado essa pessoa em específico, porque esses detalhes muitas vezes ajudam a descobrir datas, locais e ligações familiares. Além disso, são também material histórico para documentar mais sobre a história da tua família. Se alguém partilhar essas memórias, pode ser útil gravar a conversa. Depois, podes ajustar as tuas notas.</p>
        </div>
    `);

    if (selectedCountry === 'all' || selectedCountry === 'pt') {
        parts.push(`
            <div class="hint-box">
                <span class="hint-priority">Pede registos (se for necessário)</span>
                <h4>Conservatórias por e‑mail</h4>
                <p>Normalmente, é possível pedires relatórios por e-mail por apenas cerca de 1 a 2€ cada. Para enviares o pedido para a CRC (Conservatória do Registo Civil) certa, confirma sempre o concelho e a freguesia. Se pensares que estás longe de uma CRC, ou até mesmo no estrangeiro, ou se apenas não preferires deslocar‑te, o e-mail costuma ser a forma mais simples. Quanto mais detalhes transmitires, mais rápida será a resposta.</p>

                <p style="margin-top:8px; font-weight:600;">Uma boa estrutura de e‑mail é a seguinte:</p>
                <pre style="white-space:pre-wrap; background:#fbfbfb; padding:10px; border-radius:6px; border:1px solid #eee; font-size:13px; line-height:1.4;">Assunto: Pedido de cópia de registo de [ESCOLHE UMA DAS SEGUINTES OPÇÕES: batismo, casamento ou óbito] para fins genealógicos.

Corpo do e-mail:

Exmos. Senhores,

Chamo‑me [INSERE AQUI O TEU NOME COMPLETO] e solicito uma cópia simples não autenticada do registo de [O QUE ESTÁS A PEDIR] de [A(S) PESSOA(S) QUE TU QUERES OBTER MAIS INFORMAÇÃO E O TEU GRAU DE PARENTESCO].
[PESSOA(S)-ALVO], [ESCOLHE ENTRE FILHO/A OU FILHOS] de [PAI(S) DE/DAS PESSOA(S)-ALVO], [NASCEU/CASOU(ARAM)/FALECEU CONFORME COM O QUE ESTÁS A PEDIR] em [INSERE DATA], em [INSERE LOCALIZAÇÃO, OU PELO MENOS A FREGUESIA (OU O CONCELHO SE NÃO SOUBERES A FREGUESIA)].
Solicito todos os detalhes disponíveis no registo, incluindo a(s) filiação/ões completa(s), naturalidade(s), profissão/ões e outra(s) informação/ões presente(s).
Tratando‑se de um pedido para fins genealógicos sem efeitos legais ou administrativos, solicito uma cópia simples não autenticada, caso esteja disponível, por ter custo inferior à certidão autenticada.
Agradeço que me informem sobre o procedimento necessário, incluindo o custo associado e a forma de pagamento aceite.
Fico disponível para fornecer quaisquer informações adicionais necessárias.

Agradeço antecipadamente a vossa atenção.

Com os melhores cumprimentos,

[INSERE AQUI O TEU NOME COMPLETO]</pre>
            </div>
        `);
    }



    parts.push(`
        <div class="hint-box">
            <span class="hint-priority">Onde procurar</span>
            <h4>CRC (desde 1911) ou livros paroquiais (antes de 1911)</h4>
            <p>Usa o <a href="https://tombo.pt/">tombo.pt</a> para encontrares registos paroquiais. Para registos mais recentes, consulta ou contacta uma Conservatória de Registo Civil (CRC) ou a plataforma <a href="https://www.civilonline.mj.pt/CivilOnline/Certidao/avisoCertificadoOnline.jsp">Civil Online</a>. As CRCs normalmente só têm registos de pessoas que já faleceram; no entanto, custam muito menos do que a Civil Online (1 ou 2€ em vez de 10€).</p>
        </div>
    `);

    parts.push(`
        <div class="hint-box">
            <span class="hint-priority">Ordem</span>
            <h4>Que registos pedir primeiro</h4>
            <p>Depende das pistas que já tens. Na maioria dos casos compensa começar pelo assento de nascimento, mas se tiveres boas pistas sobre o casamento dos pais, começa por aí.</p>
        </div>
    `);

    parts.push(`
        <div class="hint-box">
            <span class="hint-priority">Como usar o Tombo</span>
            <h4>Passos rápidos</h4>
            <p>Vai ao <a href="https://tombo.pt/">tombo.pt</a> → procura por concelho/freguesia → vê a lista de livros disponíveis → prime o link do livro respetivo, conforme o período de tempo → vê mais informações sobre a tua ascendência. Recomendo que transcrevas na grafia portuguesa da época num documento de notas todos os links e o texto exato de cada registo que consultaste para a tua investigação, de modo a que possas agregar fontes e não perderes nenhuns detalhes.</p>        </div>
    `);

    parts.push(`
            <div class="hint-box">
                <span class="hint-priority">Links rápidos</span>
                <h4>Recursos</h4>
                <p><a href="https://www.civilonline.mj.pt/CivilOnline/Certida/">Civil Online</a> · <a href="https://tombo.pt/">Tombo.pt</a> · <a href="https://www.familysearch.org/">FamilySearch</a></p>
                <div style="margin-top:8px; display:flex; gap:8px;"><button class="hud-btn" onclick="generateChecklistDownload()">Descarregar checklist</button></div>
            </div>
    `);

    if (!(selectedCountry === 'all' || selectedCountry === 'pt')) {
        const rebuilt = parts.join('').replace(/<div class="hint-box">[\s\S]*?<h4>Recursos<\/h4>[\s\S]*?<\/div>\s*/, '');
    }

    if (detectedCountries.includes('es') && (selectedCountry === 'all' || selectedCountry === 'es')) {
        const uiLang = lang;
        const sp = {
            en: '<p><strong>English:</strong> Modern civil registration began in 1871; earlier entries are usually in parish registers. Contact the local <em>Registro Civil</em> or municipal archive to request records. Many items are digitised on PARES and FamilySearch. Identify municipality/parish and book reference, request a <em>copia simple</em> for genealogy, include full names, dates, parents\' names and your relationship, and check local fees.</p>',
            es: '<p><strong>Español:</strong> El registro civil moderno en España data de 1871; antes la información aparece en libros parroquiales. Para solicitar actas contacte con el Registro Civil o el archivo municipal. Muchos registros están en PARES y FamilySearch. Identifique municipio/parroquia y referencia, pida una "copia simple" para fines genealógicos e incluya nombres completos, fechas y parentesco.</p>',
            gl: '<p><strong>Galego:</strong> O rexistro civil moderno data de 1871; antes os asentos están en libros parroquiais. Contacte co Rexistro Civil local ou co arquivo municipal para solicitar as actas. Moitos rexistros están en PARES e FamilySearch.</p>',
            ca: '<p><strong>Català:</strong> El registre civil modern comença el 1871; abans els registres estan en llibres parroquials. Contacteu amb el Registro Civil o l\'arxiu municipal per demanar actes. Molts registres estan a PARES i FamilySearch.</p>',
            eu: '<p><strong>Euskara:</strong> Espainiako errolda 1871ean hasi zen; aurreko erregistroak parrokiako liburuetan daude. Tokiko <em>Registro Civil</em> edo artxiboarekin jarri harremanetan aktak eskuratzeko. Askok PARES eta FamilySearch-en daude digitalizatuta.</p>'
        };
        let bodyHtml = '';
        if (['en', 'es', 'gl', 'ca', 'eu'].includes(uiLang)) {
            bodyHtml = sp[uiLang];
        } else {
            bodyHtml = sp.en + sp.es + sp.gl + sp.ca + sp.eu;
        }
        parts.push(`
            <div class="hint-box">
                <span class="hint-priority">Spain / España</span>
                <h4>Resumen de registos</h4>
                ${bodyHtml}
                <p style="margin-top:8px; font-weight:600;">Links úteis / Enlaces / Ligazóns:</p>
                <p><a href="https://pares.culturaydeporte.gob.es">PARES</a> · <a href="https://sede.mjusticia.gob.es/es/servicios/registro-civil">Registro Civil (Ministerio)</a> · <a href="https://www.familysearch.org/">FamilySearch</a></p>
            </div>
        `);
    }

    if (birthYear && (birthYear >= 1807 && birthYear <= 1814)) {
        parts.push(`
            <div class="hint-box">
                <span class="hint-priority">Contexto histórico</span>
                <h4>Período complicado</h4>
                <p>Registos desta época podem ter lacunas por causa da Guerra Peninsular. Não desanimes se encontrares falhas.</p>
            </div>
        `);
    }

    if (!node.firstName && !node.surname) {
        parts.push(`
            <div class="hint-box">
                <span class="hint-priority">Passo imediato</span>
                <h4>Escreve pelo menos um nome</h4>
                <p>Introduz pelo menos um nome ou apelido para obter sugestões de pesquisa e ativar dicas mais específicas.</p>
            </div>
        `);
    } else {
        parts.push(`
            <div class="hint-box">
                <span class="hint-priority">Pesquisa online</span>
                <h4>Registos de pessoas falecidas</h4>
                <p>Se a pessoa já faleceu, pesquisa no <a href="https://www.familysearch.org/">FamilySearch</a> ou no <a href="https://geneall.net/pt/">Geneall</a>. São duas boas fontes para registos indexados e árvores de pessoas falecidas.</p>
            </div>
        `);
    }

    hintsContainer.innerHTML = parts.join('\n');
}

function generateChecklistDownload() {
    const lang = window.hintsLang || localStorage.getItem('hintsLang') || 'pt';
    const effectiveLang = (lang === 'pt') ? 'pt' : 'en';
    const textLines = [];
    if (effectiveLang === 'en') {
        textLines.push('Checklist for requesting records:');
        textLines.push('- Full name of the person (include variants)');
        textLines.push('- Type of record: birth / marriage / death');
        textLines.push('- Year (or approximate) and county/locality');
        textLines.push('- Parents\' names (if known)');
        textLines.push('- Request non-certified photocopies if you don\'t need an official certificate');
        textLines.push('');
        textLines.push('Quick tips:');
        textLines.push('- Ask family; scan photos; keep source notes.');
        const selCountry = window.hintsCountry || localStorage.getItem('hintsCountry') || 'all';
        if (selCountry === 'all' || selCountry === 'pt') {
            textLines.push('- Use Tombo.pt for parish books; Civil Online for recent requests.');
        }
    } else {
        textLines.push('Checklist para pedir registos:');
        textLines.push('- Nome completo da pessoa (inclui variantes)');
        textLines.push('- Tipo de registo: nascimento / casamento / óbito');
        textLines.push('- Ano (ou intervalo aproximado) e concelho');
        textLines.push('- Nomes dos pais (se souberes)');
        textLines.push('- Indicar: fotocópias não certificadas (se aplicável)');
        textLines.push('');
        textLines.push('Dicas rápidas:');
        textLines.push('- Fala com a tua família; digitaliza fotos; guarda fontes.');
        const selCountryPt = window.hintsCountry || localStorage.getItem('hintsCountry') || 'all';
        if (selCountryPt === 'all' || selCountryPt === 'pt') {
            textLines.push('- Procura em Tombo.pt para livros paroquiais; usa Civil Online para pedidos recentes.');
        }
    }

    const blob = new Blob([textLines.join('\n')], {
        type: 'text/plain;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'checklist-genealogia.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function toggleHints() {
    const overlay = document.getElementById('hints-overlay');
    if (!overlay) return;
    if (overlay.classList.contains('hidden')) {
        const treeData = getActiveTree().data;
        const node = treeData[activeNodeId] || {
            firstName: '',
            surname: '',
            birthDate: '',
            birthPlace: ''
        };
        generateSmartHints(node);
        const src = document.getElementById('hints-container');
        const body = overlay.querySelector('.hints-body');
        const lang = window.hintsLang || localStorage.getItem('hintsLang') || 'pt';
        const emptyMsg = (lang === 'en') ?
            '<div class="hint-box"><p>No hints available.</p></div>' :
            '<div class="hint-box"><p>Sem dicas disponíveis.</p></div>';
        body.innerHTML = src ? src.innerHTML : emptyMsg;
        try {
            ensureHintsCountrySelect();
        } catch (e) {
            console.error('ensureHintsCountrySelect failed', e);
        }
        overlay.classList.remove('hidden');
        overlay.querySelector('.hints-close-btn')?.focus();
    } else {
        overlay.classList.add('hidden');
    }
}

function syncLanguageUiText() {
    const lang = window.hintsLang || localStorage.getItem('hintsLang') || 'pt';
    const infoBtn = document.getElementById('info-toggle-btn');
    const overlay = document.getElementById('hints-overlay');
    const title = document.getElementById('hints-overlay-title');
    const closeBtn = document.getElementById('hints-close-btn');

    if (lang === 'en') {
        if (infoBtn) {
            infoBtn.setAttribute('aria-label', 'Show hints');
            infoBtn.setAttribute('title', 'Show hints');
        }
        if (overlay) overlay.setAttribute('aria-label', 'Hints');
        if (title) title.textContent = 'Hints & Suggestions';
        if (closeBtn) closeBtn.setAttribute('aria-label', 'Close hints');
    } else {
        if (infoBtn) {
            infoBtn.setAttribute('aria-label', 'Mostrar dicas');
            infoBtn.setAttribute('title', 'Mostrar dicas');
        }
        if (overlay) overlay.setAttribute('aria-label', 'Dicas');
        if (title) title.textContent = 'Dicas & Sugestões';
        if (closeBtn) closeBtn.setAttribute('aria-label', 'Fechar dicas');
    }
}

function setHintsLanguage(lang) {
    window.hintsLang = lang;
    localStorage.setItem('hintsLang', lang);
    syncLanguageUiText();
    const treeData = getActiveTree().data;
    const node = treeData[activeNodeId] || {
        firstName: '',
        surname: '',
        birthDate: '',
        birthPlace: ''
    };
    generateSmartHints(node);
    const overlay = document.getElementById('hints-overlay');
    if (overlay && !overlay.classList.contains('hidden')) {
        const src = document.getElementById('hints-container');
        const body = overlay.querySelector('.hints-body');
        body.innerHTML = src ? src.innerHTML : '';
        try {
            ensureHintsCountrySelect();
        } catch (e) {
            console.error('ensureHintsCountrySelect failed', e);
        }
    }
    try {
        saveSettingsToDatabase();
    } catch (e) {
        /* ignore */
    }
}

function setHintsCountry(code) {
    window.hintsCountry = code;
    localStorage.setItem('hintsCountry', code);
    try {
        const countryLangMap = {
            es: 'en',
            pt: 'pt'
        };
        const allowedLangsMap = {
            es: ['en', 'es', 'gl', 'ca', 'eu'],
            pt: ['pt', 'en']
        };
        const allowed = allowedLangsMap[code] || null;
        if (!allowed || (window.hintsLang && allowed.includes(window.hintsLang))) {} else {
            const desired = countryLangMap[code] || window.hintsLang || localStorage.getItem('hintsLang') || 'pt';
            window.hintsLang = desired;
            localStorage.setItem('hintsLang', desired);
            const ls = document.getElementById('langSelect');
            if (ls) ls.value = desired;
        }
    } catch (e) {
        console.error('error setting default lang for country', e);
    }
    const treeData = getActiveTree().data;
    const node = treeData[activeNodeId] || {
        firstName: '',
        surname: '',
        birthDate: '',
        birthPlace: ''
    };
    generateSmartHints(node);
    const overlay = document.getElementById('hints-overlay');
    if (overlay && !overlay.classList.contains('hidden')) {
        const src = document.getElementById('hints-container');
        const body = overlay.querySelector('.hints-body');
        body.innerHTML = src ? src.innerHTML : '';
        try {
            ensureHintsCountrySelect();
        } catch (e) {
            console.error('ensureHintsCountrySelect failed', e);
        }
        try {
            updateLangOptionsForCountry(window.hintsCountry || localStorage.getItem('hintsCountry') || 'pt');
        } catch (e) {
            console.error(e);
        }
    }
    try {
        saveSettingsToDatabase();
    } catch (e) {
        /* ignore */
    }
}

function ensureHintsCountrySelect() {
    const overlay = document.getElementById('hints-overlay');
    if (!overlay) return;
    const head = overlay.querySelector('.hints-head');
    if (!head) return;
    const existing = head.querySelector('#hints-country-wrapper');
    if (existing) existing.remove();

    const detected = detectCountriesInTree();
    if (!detected || detected.length === 0) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'hints-country-wrapper';
    wrapper.style.marginLeft = '8px';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '6px';

    const label = document.createElement('label');
    label.htmlFor = 'hints-country-select';
    label.style.fontWeight = '600';
    label.style.fontSize = '0.95rem';
    label.textContent = (window.hintsLang === 'en') ? 'Country:' : 'Country:';

    const select = document.createElement('select');
    select.id = 'hints-country-select';
    select.style.padding = '4px';
    select.style.borderRadius = '4px';
    select.onchange = function() {
        setHintsCountry(this.value);
    };

    const nameMap = {
        pt: 'Portugal',
        es: 'Spain'
    };
    const storedCountry = window.hintsCountry || localStorage.getItem('hintsCountry') || '';
    const selCountry = detected.includes(storedCountry) ? storedCountry : detected[0];
    detected.forEach(c => {
        const o = document.createElement('option');
        o.value = c;
        o.text = nameMap[c] || c.toUpperCase();
        if (selCountry === c) o.selected = true;
        select.appendChild(o);
    });

    try {
        window.hintsCountry = selCountry;
        localStorage.setItem('hintsCountry', selCountry);
    } catch (e) {
        /* ignore */
    }

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    head.insertBefore(wrapper, head.querySelector('#hints-close-btn'));
    const body = overlay.querySelector('.hints-body');
    if (body) {
        const oldBodyCopy = body.querySelector('#hints-country-wrapper-body');
        if (oldBodyCopy) oldBodyCopy.remove();
    }
    try {
        updateLangOptionsForCountry(selCountry);
    } catch (e) {
        console.error('updateLangOptionsForCountry failed', e);
    }
}

function updateLangOptionsForCountry(country) {
    const langSel = document.getElementById('langSelect');
    if (!langSel) return;
    const current = langSel.value;
    const map = {
        es: ['en', 'es', 'gl', 'ca', 'eu'],
        pt: ['pt', 'en']
    };
    const langs = map[country];
    if (!langs) return;
    langSel.innerHTML = '';
    langs.forEach(l => {
        const o = document.createElement('option');
        o.value = l;
        o.text = l.toUpperCase();
        if (l === current) o.selected = true;
        langSel.appendChild(o);
    });
    if (!langs.includes(current)) {
        const newLang = langs[0];
        langSel.value = newLang;
        setHintsLanguage(newLang);
    }
}

window.hintsLang = localStorage.getItem('hintsLang') || 'pt';
document.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('langSelect');
    if (sel) sel.value = window.hintsLang;
    syncLanguageUiText();
    try {
        const stored = localStorage.getItem('hintsCountry');
        const detected = typeof detectCountriesInTree === 'function' ? detectCountriesInTree() : [];
        if (stored && detected && detected.length > 0 && !detected.includes(stored)) {
            console.log('Stored hintsCountry not detected in tree; preserving until settings load or user change.');
        }
    } catch (e) {
        /* ignore */
    }
});

document.addEventListener('DOMContentLoaded', () => {
    try {
        if (!window.hintsCountry) {
            const storedCountry = localStorage.getItem('hintsCountry');
            if (storedCountry) window.hintsCountry = storedCountry;
        }
        const cached = localStorage.getItem(`treeSettings:${appState.activeTreeId}`);
        if (cached) {
            try {
                const s = JSON.parse(cached);
                if (s && s.maxGenerations) appState.maxGenerations = parseInt(s.maxGenerations, 8) || appState.maxGenerations;
            } catch (e) {
                /* ignore */
            }
        }
    } catch (e) {
        /* ignore */
    }
});

document.addEventListener('DOMContentLoaded', () => {
    try {
        loadSettingsFromDatabase();
    } catch (e) {
        /* ignore */
    }
    try {
        if (typeof fetchAndApplySettings === 'function') fetchAndApplySettings().catch(() => {});
    } catch (e) {
        /* ignore */
    }
});

document.addEventListener('DOMContentLoaded', () => {
    try {
        setTimeout(syncLocalSettingsToDatabase, 500);
    } catch (e) {
        /* ignore */
    }
});

function detectCountriesInTree() {
    const treeData = getActiveTree().data;
    const countries = new Set();
    Object.values(treeData).forEach(n => {
        if (!n) return;
        ['birthPlace', 'deathPlace', 'marriagePlace'].forEach(k => {
            const v = (n[k] || '').toString().toLowerCase();
            if (!v) return;
            if (/\b(spain|espana|españa|espa)\b/i.test(v)) countries.add('es');
            if (/\b(portugal|portugu)\b/i.test(v)) countries.add('pt');
        });
    });
    return Array.from(countries);
}

const vRect = viewport.getBoundingClientRect();
panX = (vRect.width / 2) - (60000 * scale) - (NODE_WIDTH / 2);
panY = (vRect.height / 2) - (30000 * scale) - (NODE_HEIGHT / 2);

function forceInitialSave() {
    console.log("Attempting to force save to Firebase...");

    const defaultData = [{
        id: 1,
        label: "My Family Tree",
        data: {}
    }];

    db.ref('treesState').set(defaultData)
        .then(() => {
            console.log("Success! Data pushed to Firebase.");
            alert("Data pushed successfully! Please refresh.");
            saveSettingsToDatabase();
        })
        .catch((error) => {
            console.error("Save failed. Firebase Error:", error);
            alert("Save failed. Check the console for the error code.");
        });
}

let _settingsSyncInProgress = false;

function saveSettingsToDatabase() {
    const hasDb = !!db;
    if (_settingsSyncInProgress) return Promise.resolve();
    _settingsSyncInProgress = true;
    try {
        const settings = {
            hintsLang: window.hintsLang || localStorage.getItem('hintsLang') || 'pt',
            hintsCountry: window.hintsCountry || localStorage.getItem('hintsCountry') || 'all',
            maxGenerations: appState.maxGenerations || 3
        };

        try {
            cacheSettingsLocally(appState.activeTreeId, settings);
        } catch (e) {
            console.error('local save failed', e);
        }

        if (!hasDb) {
            _settingsSyncInProgress = false;
            return Promise.resolve();
        }

        const path = `trees/${appState.activeTreeId}/settings`;
        return db.ref(path).set(settings).then(() => {
            _settingsSyncInProgress = false;
        }).catch(err => {
            console.error('Firebase write failed, keeping local cache', err);
            _settingsSyncInProgress = false;
        });
    } catch (e) {
        console.error('saveSettingsToDatabase failed', e);
        _settingsSyncInProgress = false;
        return Promise.resolve();
    }
}

function cacheSettingsLocally(treeId, settings) {
    if (!treeId || !settings) return;
    try {
        const key = `treeSettings:${treeId}`;
        localStorage.setItem(key, JSON.stringify(settings));
        if (settings.hintsLang) localStorage.setItem('hintsLang', settings.hintsLang);
        if (settings.hintsCountry) localStorage.setItem('hintsCountry', settings.hintsCountry);
        console.log('Cached settings locally for', key, settings);
    } catch (e) {
        console.error('cacheSettingsLocally failed', e);
    }
}

function loadSettingsFromDatabase() {
    if (!db) return;
    _settingsSyncInProgress = true;
    try {
        const path = `trees/${appState.activeTreeId}/settings`;
        db.ref(path).once('value').then(snapshot => {
            let s = snapshot.val();
            if (!s) {
                try {
                    const local = localStorage.getItem(`treeSettings:${appState.activeTreeId}`);
                    if (local) s = JSON.parse(local);
                } catch (e) {
                    /* ignore */
                }
            }
            if (!s) {
                _settingsSyncInProgress = false;
                return;
            }
            if (s.hintsLang) {
                window.hintsLang = s.hintsLang;
                localStorage.setItem('hintsLang', s.hintsLang);
                const sel = document.getElementById('langSelect');
                if (sel) sel.value = s.hintsLang;
            }
            if (s.hintsCountry) {
                window.hintsCountry = s.hintsCountry;
                localStorage.setItem('hintsCountry', s.hintsCountry);
            }
            if (s.maxGenerations !== undefined && s.maxGenerations !== null) {
                appState.maxGenerations = parseInt(s.maxGenerations, 8) || appState.maxGenerations;
                const slider = document.getElementById('genSlider');
                if (slider) slider.value = appState.maxGenerations;
                const disp = document.getElementById('genDisplay');
                if (disp) disp.innerText = appState.maxGenerations;
            }
            syncLanguageUiText();
            try {
                cacheSettingsLocally(appState.activeTreeId, s);
            } catch (e) {
                console.error('writing local cache failed', e);
            }
            try {
                const countrySelect = document.getElementById('hints-country-select');
                if (countrySelect && s.hintsCountry) countrySelect.value = s.hintsCountry;
            } catch (e) {
                /* ignore */
            }
            try {
                if (!window.hintsLang) window.hintsLang = localStorage.getItem('hintsLang') || s.hintsLang || window.hintsLang;
                if (!window.hintsCountry) window.hintsCountry = localStorage.getItem('hintsCountry') || s.hintsCountry || window.hintsCountry;
                if (!Number.isFinite(appState.maxGenerations) || appState.maxGenerations === undefined) appState.maxGenerations = parseInt(localStorage.getItem(`treeSettings:${appState.activeTreeId}`) ? JSON.parse(localStorage.getItem(`treeSettings:${appState.activeTreeId}`)).maxGenerations : s.maxGenerations, 8) || appState.maxGenerations;
            } catch (e) {
                console.error('ensure globals after load failed', e);
            }
            renderTreeCanvas();
            _settingsSyncInProgress = false;
        }).catch(e => {
            console.error('loadSettingsFromDatabase failed', e);
            _settingsSyncInProgress = false;
        });
    } catch (e) {
        console.error('loadSettingsFromDatabase crashed', e);
        _settingsSyncInProgress = false;
    }
}

async function fetchAndApplySettings() {
    if (!db) return Promise.reject(new Error('no db'));
    const id = appState.activeTreeId;
    const path = `trees/${id}/settings`;
    try {
        const snap = await db.ref(path).once('value');
        const s = snap.val();
        if (!s) return Promise.resolve(null);
        if (s.hintsLang) {
            window.hintsLang = s.hintsLang;
            localStorage.setItem('hintsLang', s.hintsLang);
            const sel = document.getElementById('langSelect');
            if (sel) sel.value = s.hintsLang;
        }
        if (s.hintsCountry) {
            window.hintsCountry = s.hintsCountry;
            localStorage.setItem('hintsCountry', s.hintsCountry);
        }
        if (s.maxGenerations !== undefined && s.maxGenerations !== null) {
            appState.maxGenerations = parseInt(s.maxGenerations, 8) || appState.maxGenerations;
            const slider = document.getElementById('genSlider');
            if (slider) slider.value = appState.maxGenerations;
            const disp = document.getElementById('genDisplay');
            if (disp) disp.innerText = appState.maxGenerations;
        }
        cacheSettingsLocally(id, s);
        try {
            localStorage.setItem(`treeSettings:${id}`, JSON.stringify(s));
        } catch (e) {
            /* ignore */
        }
        renderTreeCanvas();
        return s;
    } catch (e) {
        console.error('fetchAndApplySettings failed', e);
        return Promise.reject(e);
    }
}

window.fetchAndApplySettings = fetchAndApplySettings;

try {
    ensureInitialSettings();
} catch (e) {
    /* ignore */
}

try {
    window.saveSettingsToDatabase = saveSettingsToDatabase;
    window.loadSettingsFromDatabase = loadSettingsFromDatabase;
    window.syncLocalSettingsToDatabase = syncLocalSettingsToDatabase;
    window.setHintsLanguage = setHintsLanguage;
    window.setHintsCountry = setHintsCountry;
    window.cacheSettingsLocally = cacheSettingsLocally;
    globalThis.saveSettingsToDatabase = saveSettingsToDatabase;
    globalThis.loadSettingsFromDatabase = loadSettingsFromDatabase;
    globalThis.syncLocalSettingsToDatabase = syncLocalSettingsToDatabase;
    globalThis.setHintsLanguage = setHintsLanguage;
    globalThis.setHintsCountry = setHintsCountry;
    globalThis.cacheSettingsLocally = cacheSettingsLocally;
} catch (e) {
    console.error('Error setting global functions', e);
}

window.addEventListener('load', () => {
    try {
        window.saveSettingsToDatabase = saveSettingsToDatabase;
        window.loadSettingsFromDatabase = loadSettingsFromDatabase;
        window.syncLocalSettingsToDatabase = syncLocalSettingsToDatabase;
        window.setHintsLanguage = setHintsLanguage;
        window.setHintsCountry = setHintsCountry;
        globalThis.saveSettingsToDatabase = saveSettingsToDatabase;
        globalThis.loadSettingsFromDatabase = loadSettingsFromDatabase;
        globalThis.syncLocalSettingsToDatabase = syncLocalSettingsToDatabase;
        globalThis.setHintsLanguage = setHintsLanguage;
        globalThis.setHintsCountry = setHintsCountry;
    } catch (e) {
        console.error('Error setting global functions', e);
    }
});

function syncLocalSettingsToDatabase() {
    if (!db) return;
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith('treeSettings:')) continue;
            try {
                const id = key.split(':')[1];
                const data = JSON.parse(localStorage.getItem(key));
                if (!data) continue;
                const path = `trees/${id}/settings`;
                db.ref(path).set(data).then(() => {
                    console.log('Synced settings for tree', id, '- keeping local cache as fallback');
                }).catch(e => {
                    console.error('syncLocalSettingsToDatabase write failed for', id, e);
                });
            } catch (e) {
                /* ignore per-key errors */
            }
        }
    } catch (e) {
        console.error('syncLocalSettingsToDatabase failed', e);
    }
}

function loadSettingsForActiveTree() {
    loadSettingsFromDatabase();
}

function startRenderLoop() {
    function loop() {
        if (window.needsUpdate) {
            window.renderTreeCanvas();
            window.needsUpdate = false;
        }
        requestAnimationFrame(loop);
    }
    loop();
}

startRenderLoop();

window.isTreeDirty = true;

function renderLoop() {
    if (window.isTreeDirty) {
        renderTreeCanvas();
        window.isTreeDirty = false;
    }
    requestAnimationFrame(renderLoop);
}

requestAnimationFrame(renderLoop);

updateTreeSelector();
renderTreeCanvas();
openLedger('root');
initDatabaseListener();