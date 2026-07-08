// =============================================================================
// family-tree.js
// -----------------------------------------------------------------------------
// Fully offline, dependency-free Family Tree renderer for the SIR Family Forms
// tool. No CDN, no third-party library (no BALKAN / Family Echo / D3 / ELK /
// Dagre). Everything below is plain JavaScript + inline SVG.
//
// Pipeline:
//   people_database + applicant_database
//     -> buildFamilyTreeModel()   (FamilyScript-style internal model)
//     -> buildComponents()        (split into disconnected family groups)
//     -> layoutFamilyComponent()  (couple-based tree layout, per component)
//     -> renderSvg()              (person boxes + clean connectors)
//
// This file is intentionally self-contained: family-tree.html only provides
// the page shell (title, canvas container, toolbar buttons). All behaviour
// lives here so the rest of the app is untouched.
// =============================================================================

import { loadState } from "./storage.js";

/* ============================================================================
 * 1. CONSTANTS
 * ========================================================================== */

const BOX_W = 250;           // person box width
const BOX_H = 90;            // person box height
const SPOUSE_GAP = 16;       // gap between two boxes that form a couple
const SIBLING_GAP = 36;      // horizontal gap between adjacent sibling subtrees
const LEVEL_GAP = 100;       // vertical gap between generations
const STEM = 26;             // vertical stem length from a box edge to a bar
const COMPONENT_GAP = 90;    // vertical gap between disconnected family trees
const TITLE_H = 34;          // height reserved for a component's title text
const CANVAS_PAD = 20;       // outer canvas padding

const MALE_COLOR = "#2563EB";
const FEMALE_COLOR = "#DB2777";

const PLACEHOLDER_NAMES = new Set(["father", "mother", "mapper", "applicant"]);
const MANUAL_NODE_NUDGE_X = [];

/* ============================================================================
 * 2. SMALL UTILITIES
 * ========================================================================== */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[ch]));
}

function escapeXml(value) {
  return escapeHtml(value);
}

// Truncate text so it does not overflow a box of a given pixel width.
// Rough monospace-ish estimate is fine here: we only need to avoid gross
// overflow, not pixel-perfect measurement (there is no DOM canvas dependency
// in the pure-logic path so this stays deterministic/testable).
function truncateForWidth(text, pixelWidth, approxCharWidth = 6.4) {
  const str = String(text || "");
  const maxChars = Math.max(4, Math.floor(pixelWidth / approxCharWidth));
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars - 1).trimEnd() + "…";
}

function joinAvailable(parts) {
  return parts.filter(p => p !== null && p !== undefined && String(p).trim() !== "").join(", ");
}

/* ============================================================================
 * 3. GENDER / PLACEHOLDER HELPERS
 * ========================================================================== */

// A person record counts as a "placeholder" stand-in (Father / Mother /
// Mapper / Applicant) rather than a real, uniquely identified individual.
// Placeholder person_ids must never be silently reused across unrelated
// relationships (see createInternalNode / resolveNode below).
export function isPlaceholderPerson(person) {
  if (!person) return false;
  const name = String(person.name || "").trim().toLowerCase();
  return PLACEHOLDER_NAMES.has(name);
}

// Builds the "State, District" line (Line 2) from a source person's 2002
// fields. Only pieces that are actually available are included; no dashes,
// no empty rows.
function formatStateDistrict(source) {
  return joinAvailable([source?.state_2002, source?.district_2002]);
}

// Builds the "AC: x, Part: y, Serial: z" line (Line 3). Only available
// pieces are included.
function formatAcPartSerial(source) {
  const pieces = [];
  if (source?.ac_no_2002) pieces.push(`AC: ${source.ac_no_2002}`);
  if (source?.part_no_2002) pieces.push(`Part: ${source.part_no_2002}`);
  if (source?.sl_no_2002) pieces.push(`Serial: ${source.sl_no_2002}`);
  return pieces.join(", ");
}

/* ============================================================================
 * 4. INTERNAL MODEL CONSTRUCTION
 * ========================================================================== */

// Pure factory: turns a raw people_database record into an internal node.
// gender is "male" | "female" | null and is supplied by the caller based on
// how the person is being *used* (father_person_id => male, etc.) — this
// function does not infer anything on its own.
export function createInternalNode(sourcePerson, internalId, gender) {
  const source = sourcePerson || { person_id: internalId, name: "Unknown" };
  return {
    id: internalId,
    sourceId: source.person_id || internalId,
    name: String(source.name || "").trim() || "Unknown",
    epic: String(source.epic_number || "").trim(),
    gender: gender || null,
    stateDistrict: formatStateDistrict(source),
    acPartSerial: formatAcPartSerial(source),
    isPlaceholder: isPlaceholderPerson(source),
    isApplicant: false
  };
}

// Generates a suffixed relationship id for a placeholder person the Nth time
// it is encountered in a *new* relationship context (a new applicant row).
// Example: person_mraztjk2_9lwttp -> person_mraztjk2_9lwttp_1, _2, ...
const placeholderCounters = new Map();
export function makeRelationshipId(personId) {
  const next = (placeholderCounters.get(personId) || 0) + 1;
  placeholderCounters.set(personId, next);
  return `${personId}_${next}`;
}

function resetModelBuildState() {
  placeholderCounters.clear();
}

function addSpousePair(model, aId, bId) {
  if (!aId || !bId || aId === bId) return;
  const exists = model.spousePairs.some(pair =>
    (pair.a === aId && pair.b === bId) || (pair.a === bId && pair.b === aId));
  if (!exists) model.spousePairs.push({ a: aId, b: bId, children: [] });
}

// Reads whichever key naming the caller happens to use. The rest of this app
// stores in-memory state as { people, applicants }; the exported/imported
// JSON payload (and this feature's spec) calls the same arrays
// people_database / applicant_database. Both are accepted so the module
// stays usable either from app.js's live state or from a raw JSON blob.
function getPeopleArray(appState) {
  return appState?.people_database || appState?.people || [];
}
function getApplicantArray(appState) {
  return appState?.applicant_database || appState?.applicants || [];
}

// Builds the FamilyScript-style internal model from app state.
export function buildFamilyTreeModel(appState) {
  resetModelBuildState();

  const people = getPeopleArray(appState);
  const applicants = getApplicantArray(appState);
  const peopleById = new Map(people.map(p => [p.person_id, p]));

  const model = {
    nodes: new Map(),       // internalId -> node
    childParents: new Map(),// childInternalId -> { fatherId, motherId }
    spousePairs: [],        // [{ a, b, children: [] }]
    mapperLinks: [],        // [{ from, to, label }]
    applicantNodeIds: new Set()
  };

  // Real (non-placeholder) people are shared across every relationship they
  // appear in, keyed by their true person_id, so siblings/spouses referenced
  // from different applicant rows correctly resolve to the same node.
  const globalNodeByPersonId = new Map();

  applicants.forEach(applicant => {
    // Placeholder people are only safe to reuse *within the same applicant
    // row* (e.g. mapper_person_id === father_person_id for a "Father"
    // mapping). Across different rows they must be duplicated.
    const rowCache = new Map();

    const resolve = (personId, genderHint) => {
      if (!personId) return null;
      const source = peopleById.get(personId) || { person_id: personId, name: "Unknown" };

      if (!isPlaceholderPerson(source)) {
        let node = globalNodeByPersonId.get(personId);
        if (!node) {
          node = createInternalNode(source, personId, genderHint || null);
          globalNodeByPersonId.set(personId, node);
          model.nodes.set(node.id, node);
        } else if (genderHint && !node.gender) {
          node.gender = genderHint;
        }
        return node;
      }

      if (rowCache.has(personId)) return rowCache.get(personId);
      const internalId = makeRelationshipId(personId);
      const node = createInternalNode(source, internalId, genderHint || null);
      rowCache.set(personId, node);
      model.nodes.set(node.id, node);
      return node;
    };

    const child = resolve(applicant.person_id, null);
      if (child) model.applicantNodeIds.add(child.id);

    const father = resolve(applicant.father_person_id, "male");
    const mother = resolve(applicant.mother_person_id, "female");
    const spouse = applicant.spouse_person_id ? resolve(applicant.spouse_person_id, null) : null;
    const mapper = applicant.mapper_person_id ? resolve(applicant.mapper_person_id, null) : null;

    if (child && (father || mother)) {
      model.childParents.set(child.id, {
        fatherId: father ? father.id : null,
        motherId: mother ? mother.id : null
      });
    }

    if (father && mother) addSpousePair(model, father.id, mother.id);
    if (child && spouse) addSpousePair(model, child.id, spouse.id);

    // Mapper: only a distinct, dashed link when the mapper is NOT already
    // the father / mother / spouse / the applicant themselves in this row.
    if (mapper && child) {
      const alreadyLinked = [father?.id, mother?.id, spouse?.id, child.id].includes(mapper.id);
      if (!alreadyLinked) {
        model.mapperLinks.push({
          from: child.id,
          to: mapper.id,
          label: String(applicant.mapper_relationship || "").trim()
        });
      }
    }
  });

  model.nodes.forEach(node => {
    node.isApplicant = model.applicantNodeIds.has(node.id);
  });

  return model;
}

/* ============================================================================
 * 5. CONNECTED COMPONENTS ("Family Tree 1", "Family Tree 2", ...)
 * ========================================================================== */

// Splits the model into disconnected family groups using only blood/marriage
// edges (parent + spouse links) — mapper links are a soft cross-reference and
// do not merge two families into one tree.
export function buildComponents(model) {
  const parent = new Map();
  const find = x => {
    while (parent.get(x) !== x) x = parent.get(x);
    return x;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  model.nodes.forEach((_, id) => parent.set(id, id));

  model.childParents.forEach((parents, childId) => {
    if (parents.fatherId) union(childId, parents.fatherId);
    if (parents.motherId) union(childId, parents.motherId);
  });
  model.spousePairs.forEach(pair => union(pair.a, pair.b));

  const groups = new Map(); // root -> [nodeIds] (in first-seen order)
  model.nodes.forEach((_, id) => {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  });

  return Array.from(groups.values()).map(nodeIds => ({ nodeIds }));
}

/* ============================================================================
 * 6. COUPLE-BASED LAYOUT ENGINE
 * ========================================================================== */

// Computes a generation depth for every node in a component. Depth flows
// down from parent -> child, and spouses are pulled to the same generation
// as each other (a fixed-point relaxation is enough for the size of data
// this tool handles).
function computeDepths(nodeIds, model) {
  const idSet = new Set(nodeIds);
  const depth = new Map(nodeIds.map(id => [id, 0]));

  let changed = true;
  let guard = 0;
  while (changed && guard < nodeIds.length + 5) {
    changed = false;
    guard += 1;

    model.childParents.forEach((parents, childId) => {
      if (!idSet.has(childId)) return;
      const fatherDepth = parents.fatherId && idSet.has(parents.fatherId) ? depth.get(parents.fatherId) : null;
      const motherDepth = parents.motherId && idSet.has(parents.motherId) ? depth.get(parents.motherId) : null;
      if (fatherDepth === null && motherDepth === null) return;
      const parentDepth = Math.max(fatherDepth ?? -Infinity, motherDepth ?? -Infinity);
      const required = parentDepth + 1;
      if (required > depth.get(childId)) {
        depth.set(childId, required);
        changed = true;
      }
    });

    model.spousePairs.forEach(pair => {
      if (!idSet.has(pair.a) || !idSet.has(pair.b)) return;
      const max = Math.max(depth.get(pair.a), depth.get(pair.b));
      if (depth.get(pair.a) !== max) { depth.set(pair.a, max); changed = true; }
      if (depth.get(pair.b) !== max) { depth.set(pair.b, max); changed = true; }
    });
  }

  // Compact skipped generations: if a parent cluster can be lifted closer to
  // its children (to exactly childDepth - 1) without violating constraints,
  // do so. This keeps peers from the same generation visually aligned.
  const groupParent = new Map();
  const gFind = id => {
    while (groupParent.get(id) !== id) id = groupParent.get(id);
    return id;
  };
  const gUnion = (a, b) => {
    const ra = gFind(a);
    const rb = gFind(b);
    if (ra !== rb) groupParent.set(ra, rb);
  };

  nodeIds.forEach(id => groupParent.set(id, id));
  model.spousePairs.forEach(pair => {
    if (!idSet.has(pair.a) || !idSet.has(pair.b)) return;
    gUnion(pair.a, pair.b);
  });

  const groupDepth = new Map();
  const childrenByGroup = new Map();

  nodeIds.forEach(id => {
    const g = gFind(id);
    groupDepth.set(g, Math.max(groupDepth.get(g) ?? -Infinity, depth.get(id) ?? 0));
  });

  model.childParents.forEach((parents, childId) => {
    if (!idSet.has(childId)) return;
    const childGroup = gFind(childId);
    [parents.fatherId, parents.motherId].forEach(parentId => {
      if (!parentId || !idSet.has(parentId)) return;
      const parentGroup = gFind(parentId);
      if (parentGroup === childGroup) return;
      if (!childrenByGroup.has(parentGroup)) childrenByGroup.set(parentGroup, []);
      childrenByGroup.get(parentGroup).push(childGroup);
    });
  });

  let compactChanged = true;
  let compactGuard = 0;
  while (compactChanged && compactGuard < nodeIds.length + 5) {
    compactChanged = false;
    compactGuard += 1;

    childrenByGroup.forEach((childGroups, parentGroup) => {
      const current = groupDepth.get(parentGroup) ?? 0;
      const minChildDepth = Math.min(...childGroups.map(g => groupDepth.get(g) ?? 0));
      const target = minChildDepth - 1;
      if (target > current) {
        groupDepth.set(parentGroup, target);
        compactChanged = true;
      }
    });
  }

  nodeIds.forEach(id => {
    const g = gFind(id);
    depth.set(id, groupDepth.get(g) ?? (depth.get(id) ?? 0));
  });

  return depth;
}

// Groups children by their exact parent pair (fatherId|motherId) so full
// siblings share a single comb connector.
function buildParentGroups(nodeIds, model) {
  const idSet = new Set(nodeIds);
  const groups = new Map(); // key -> { fatherId, motherId, childIds: [] }
  model.childParents.forEach((parents, childId) => {
    if (!idSet.has(childId)) return;
    const key = `${parents.fatherId || ""}|${parents.motherId || ""}`;
    if (!groups.has(key)) groups.set(key, { fatherId: parents.fatherId, motherId: parents.motherId, childIds: [] });
    groups.get(key).childIds.push(childId);
  });
  return groups;
}

function buildSpouseOfMap(nodeIds, model) {
  const idSet = new Set(nodeIds);
  const spouseOf = new Map();
  model.spousePairs.forEach(pair => {
    if (!idSet.has(pair.a) || !idSet.has(pair.b)) return;
    if (!spouseOf.has(pair.a)) spouseOf.set(pair.a, pair.b);
    if (!spouseOf.has(pair.b)) spouseOf.set(pair.b, pair.a);
  });
  return spouseOf;
}

// Recursive width/shape pass for a single couple-or-single "unit", starting
// at `nodeId`. Context (visited set, groups, depths, spouseOf, model) is
// threaded through model._layoutCtx so the public signature can stay
// layoutCoupleBlock(couple, model) as specified.
export function layoutCoupleBlock(nodeId, model) {
  const ctx = model._layoutCtx;
  if (ctx.visited.has(nodeId)) return null;
  ctx.visited.add(nodeId);

  let spouseId = ctx.spouseOf.get(nodeId) || null;
  if (spouseId && ctx.visited.has(spouseId)) spouseId = null; // already placed elsewhere
  if (spouseId) ctx.visited.add(spouseId);

  // Prefer showing the male member on the left, female on the right, when
  // gender is known. Final outward-facing spouse orientation is enforced in a
  // post-layout pass where parent-side direction is known.
  let members = spouseId ? [nodeId, spouseId] : [nodeId];
  if (spouseId) {
    const a = model.nodes.get(nodeId);
    const b = model.nodes.get(spouseId);
    if (a?.gender === "female" && b?.gender === "male") {
      members = [spouseId, nodeId];
    }
  }

  const pairWidth = members.length === 2 ? (BOX_W * 2 + SPOUSE_GAP) : BOX_W;

  // Find this unit's children: any parent-group keyed by this exact member
  // set (order independent).
  let childIds = [];
  for (const group of ctx.groups.values()) {
    const groupParents = [group.fatherId, group.motherId].filter(Boolean);
    const isMatch = groupParents.length > 0 &&
      groupParents.every(id => members.includes(id)) &&
      members.every(id => groupParents.includes(id) || groupParents.length === 1);
    // Simpler, exact match: the group's parent set equals this unit's member set,
    // OR (single-parent group) the lone parent is one of this unit's members.
    const exact = (groupParents.length === members.length && groupParents.every(id => members.includes(id))) ||
      (groupParents.length === 1 && members.includes(groupParents[0]));
    if (exact) childIds.push(...group.childIds);
  }
  childIds = Array.from(new Set(childIds));

  const childBlocks = childIds
    .map(childId => layoutCoupleBlock(childId, model))
    .filter(Boolean);

  const childrenWidth = childBlocks.length
    ? childBlocks.reduce((sum, c) => sum + c.width, 0) + SIBLING_GAP * (childBlocks.length - 1)
    : 0;

  const width = Math.max(pairWidth, childrenWidth);

  return {
    nodeId,
    members,
    pairWidth,
    children: childBlocks,
    width,
    depth: ctx.depths.get(nodeId) ?? 0
  };
}

// Second pass: assigns final {x, y} pixel positions from a layoutCoupleBlock
// tree, writing into positions (Map nodeId -> {x, y, w, h}).
function assignPositions(block, xStart, positions, yOffset) {
  const y = yOffset + block.depth * (BOX_H + LEVEL_GAP);
  const pairLeft = xStart + (block.width - block.pairWidth) / 2;

  block.members.forEach((memberId, i) => {
    const x = pairLeft + i * (BOX_W + SPOUSE_GAP);
    positions.set(memberId, { x, y, w: BOX_W, h: BOX_H });
  });

  if (block.children.length) {
    const childrenWidth = block.children.reduce((sum, c) => sum + c.width, 0) +
      SIBLING_GAP * (block.children.length - 1);
    let cursor = xStart + (block.width - childrenWidth) / 2;
    block.children.forEach(child => {
      assignPositions(child, cursor, positions, yOffset);
      cursor += child.width + SIBLING_GAP;
    });
  }
}

// Lays out a single connected family component using the couple-based
// algorithm: root ancestor couples/individuals first, children centered
// beneath their parent couple, spouses always side by side.
export function layoutFamilyComponent(component, model) {
  const nodeIds = component.nodeIds;
  const depths = computeDepths(nodeIds, model);
  const groups = buildParentGroups(nodeIds, model);
  const spouseOf = buildSpouseOfMap(nodeIds, model);

  model._layoutCtx = { visited: new Set(), groups, depths, spouseOf, model };

  // Roots = nodes with no recorded parents within this component. Process
  // them in first-seen order so related applicant rows (entered together)
  // tend to land near each other.
  const hasParents = new Set();
  groups.forEach(g => g.childIds.forEach(id => hasParents.add(id)));
  const roots = nodeIds.filter(id => !hasParents.has(id));

  const blocks = [];
  roots.forEach(rootId => {
    const block = layoutCoupleBlock(rootId, model);
    if (block) blocks.push(block);
  });
  // Any node never reached from a root (shouldn't normally happen, but a
  // defensive catch-all for malformed/cyclic data) still gets placed.
  nodeIds.forEach(id => {
    if (!model._layoutCtx.visited.has(id)) {
      const block = layoutCoupleBlock(id, model);
      if (block) blocks.push(block);
    }
  });

  const positions = new Map();
  let cursor = 0;
  blocks.forEach(block => {
    assignPositions(block, cursor, positions, 0);
    cursor += block.width + SIBLING_GAP * 2;
  });

  const width = Math.max(BOX_W, cursor - SIBLING_GAP * 2);
  const maxDepth = Math.max(0, ...nodeIds.map(id => depths.get(id) ?? 0));
  const height = (maxDepth + 1) * BOX_H + maxDepth * LEVEL_GAP;

  delete model._layoutCtx;
  return { positions, width, height };
}

// Stacks every component vertically, each with its own "Family Tree N"
// title, and returns one combined layout ready for renderSvg().
function layoutFamilyForest(components, model) {
  const componentLayouts = components.map(c => layoutFamilyComponent(c, model));

  let y = CANVAS_PAD;
  const placed = [];
  componentLayouts.forEach((layout, index) => {
    const xOffset = CANVAS_PAD;
    const yOffset = y + TITLE_H;
    const positions = new Map();
    layout.positions.forEach((pos, id) => {
      positions.set(id, { ...pos, x: pos.x + xOffset, y: pos.y + yOffset });
    });
    placed.push({
      title: components.length > 1 ? `Family Tree ${index + 1}` : "Family Tree",
      titleY: y + TITLE_H - 12,
      titleX: xOffset + layout.width / 2,
      positions,
      width: layout.width,
      height: layout.height
    });
    y += TITLE_H + layout.height + COMPONENT_GAP;
  });

  let minX = Infinity;
  let maxX = -Infinity;
  placed.forEach(component => {
    component.positions.forEach(pos => {
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x + pos.w);
    });
  });

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    minX = CANVAS_PAD;
    maxX = CANVAS_PAD + BOX_W;
  }

  const shiftX = CANVAS_PAD - minX;
  placed.forEach(component => {
    component.positions.forEach(pos => {
      pos.x += shiftX;
    });
  });

  const contentWidth = Math.max(BOX_W, maxX - minX);
  const totalWidth = Math.ceil(contentWidth + CANVAS_PAD * 2);
  placed.forEach(component => {
    component.titleX = totalWidth / 2;
  });

  const totalHeight = Math.max(BOX_H + TITLE_H, y - COMPONENT_GAP + CANVAS_PAD);

  return { components: placed, width: totalWidth, height: totalHeight };
}

function applyManualNodeNudges(layout, model) {
  layout.components.forEach(component => {
    component.positions.forEach((pos, id) => {
      const node = model.nodes.get(id);
      if (!node) return;
      for (const rule of MANUAL_NODE_NUDGE_X) {
        if (rule.match.test(String(node.name || ""))) {
          pos.x += rule.dx;
          break;
        }
      }
    });
  });
}

function enforceOutwardSpousePlacement(layout, model) {
  const allPositions = new Map();
  layout.components.forEach(component => {
    component.positions.forEach((pos, id) => allPositions.set(id, pos));
  });

  const directParentCount = id => {
    const rel = model.childParents.get(id);
    let count = 0;
    if (rel?.fatherId) count += 1;
    if (rel?.motherId) count += 1;
    return count;
  };

  model.spousePairs.forEach(pair => {
    const posA = allPositions.get(pair.a);
    const posB = allPositions.get(pair.b);
    if (!posA || !posB) return;

    const pcA = directParentCount(pair.a);
    const pcB = directParentCount(pair.b);
    if (pcA === pcB) return;

    const lesserId = pcA < pcB ? pair.a : pair.b;
    const richerId = pcA < pcB ? pair.b : pair.a;

    const lesserPos = allPositions.get(lesserId);
    const richerPos = allPositions.get(richerId);
    if (!lesserPos || !richerPos) return;

    const pairMidX = ((lesserPos.x + BOX_W / 2) + (richerPos.x + BOX_W / 2)) / 2;

    // Decide inward side using only the richer spouse's own parents.
    const richerParents = model.childParents.get(richerId);
    const parentIds = [
      richerParents?.fatherId,
      richerParents?.motherId
    ].filter(Boolean);
    const parentCenters = parentIds
      .map(id => allPositions.get(id))
      .filter(Boolean)
      .map(p => p.x + p.w / 2);
    if (!parentCenters.length) return;

    const parentMeanX = parentCenters.reduce((sum, x) => sum + x, 0) / parentCenters.length;
    const inwardSide = parentMeanX < pairMidX ? "left" : "right";
    const desiredLesserSide = inwardSide === "left" ? "right" : "left";

    const lesserCenterX = lesserPos.x + lesserPos.w / 2;
    const richerCenterX = richerPos.x + richerPos.w / 2;
    const currentLesserSide = lesserCenterX < richerCenterX ? "left" : "right";

    if (currentLesserSide !== desiredLesserSide) {
      const tmpX = lesserPos.x;
      lesserPos.x = richerPos.x;
      richerPos.x = tmpX;
    }
  });
}

function compactParentRows(layout, model) {
  const allPositions = new Map();
  layout.components.forEach(component => {
    component.positions.forEach((pos, id) => allPositions.set(id, pos));
  });

  const parentGroups = new Map();
  model.childParents.forEach((parents, childId) => {
    const key = `${parents.fatherId || ""}|${parents.motherId || ""}`;
    if (!parentGroups.has(key)) {
      parentGroups.set(key, {
        fatherId: parents.fatherId || null,
        motherId: parents.motherId || null,
        childIds: []
      });
    }
    parentGroups.get(key).childIds.push(childId);
  });

  const sameRow = (a, b) => Math.abs((a?.y ?? 0) - (b?.y ?? 0)) < 0.5;
  const overlaps1D = (a1, a2, b1, b2, gap = 8) => !(a2 + gap <= b1 || b2 + gap <= a1);

  const canShift = (moveIds, dx) => {
    if (!dx) return true;
    const moveSet = new Set(moveIds);
    for (const id of moveIds) {
      const pos = allPositions.get(id);
      if (!pos) return false;
      const nx1 = pos.x + dx;
      const nx2 = nx1 + pos.w;
      if (nx1 < CANVAS_PAD * 0.2) return false;

      allPositions.forEach((otherPos, otherId) => {
        if (moveSet.has(otherId)) return;
        if (!sameRow(pos, otherPos)) return;
        const ox1 = otherPos.x;
        const ox2 = otherPos.x + otherPos.w;
        if (overlaps1D(nx1, nx2, ox1, ox2)) {
          throw new Error("collision");
        }
      });
    }
    return true;
  };

  const tryShiftSafely = (moveIds, desiredDx) => {
    if (Math.abs(desiredDx) < 1) return;
    const sign = desiredDx > 0 ? 1 : -1;
    const max = Math.round(Math.abs(desiredDx));

    // Prefer the full shift, then back off toward zero until a collision-free
    // slot is found.
    for (let d = max; d >= 4; d -= 4) {
      const dx = d * sign;
      try {
        if (!canShift(moveIds, dx)) continue;
      } catch {
        continue;
      }
      moveIds.forEach(id => {
        const pos = allPositions.get(id);
        if (pos) pos.x += dx;
      });
      return;
    }
  };

  parentGroups.forEach(group => {
    if (group.childIds.length !== 1) return;
    const childPos = allPositions.get(group.childIds[0]);
    if (!childPos) return;

    const moveIds = [group.fatherId, group.motherId].filter(Boolean).filter(id => allPositions.has(id));
    if (!moveIds.length) return;

    const parentCenters = moveIds.map(id => {
      const pos = allPositions.get(id);
      return pos.x + pos.w / 2;
    });
    const parentCenter = parentCenters.reduce((sum, x) => sum + x, 0) / parentCenters.length;
    const childCenter = childPos.x + childPos.w / 2;
    const desiredDx = childCenter - parentCenter;

    tryShiftSafely(moveIds, desiredDx);
  });
}

function normalizeForestBounds(layout) {
  let minX = Infinity;
  let maxX = -Infinity;

  layout.components.forEach(component => {
    component.positions.forEach(pos => {
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x + pos.w);
    });
  });

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return;

  const shiftX = CANVAS_PAD - minX;
  if (Math.abs(shiftX) > 0.5) {
    layout.components.forEach(component => {
      component.positions.forEach(pos => {
        pos.x += shiftX;
      });
    });
  }

  const contentWidth = Math.max(BOX_W, maxX - minX);
  layout.width = Math.ceil(contentWidth + CANVAS_PAD * 2);
  layout.components.forEach(component => {
    component.titleX = layout.width / 2;
  });
}

/* ============================================================================
 * 7. SVG RENDERING
 * ========================================================================== */

function personIconSvg(gender, x, y, size) {
  if (gender !== "male" && gender !== "female") return "";
  const color = gender === "male" ? MALE_COLOR : FEMALE_COLOR;
  const scale = size / 17;
  return `
    <g transform="translate(${x}, ${y}) scale(${scale})" fill="${color}">
      <circle cx="7" cy="6" r="4.3"></circle>
      <path d="M0.5 17 C0.5 11.3 3.3 8.7 7 8.7 C10.7 8.7 13.5 11.3 13.5 17 Z"></path>
    </g>`;
}

// Renders a single person's box content, anchored at its own (0,0). The
// caller (renderSvg) wraps this in a <g transform="translate(x,y)">.
export function renderPersonNode(node) {
  const lineHeight = 18;
  const padX = 14;
  const iconSize = 14;
  const hasIcon = node.gender === "male" || node.gender === "female";
  const nameTextX = padX + (hasIcon ? iconSize + 6 : 0);

  const nameLine = truncateForWidth(
    node.epic ? `${node.name} (${node.epic})` : node.name,
    BOX_W - nameTextX - padX,
    6.6
  );

  const lines = [];
  let cursorY = 26;
  lines.push(`<text class="ft-name" x="${nameTextX}" y="${cursorY}">${escapeXml(nameLine)}</text>`);

  if (node.stateDistrict) {
    cursorY += lineHeight;
    lines.push(`<text class="ft-meta" x="${padX}" y="${cursorY}">${escapeXml(truncateForWidth(node.stateDistrict, BOX_W - padX * 2))}</text>`);
  }
  if (node.acPartSerial) {
    cursorY += lineHeight;
    lines.push(`<text class="ft-meta" x="${padX}" y="${cursorY}">${escapeXml(truncateForWidth(node.acPartSerial, BOX_W - padX * 2))}</text>`);
  }

  const icon = hasIcon ? personIconSvg(node.gender, padX, 14, iconSize) : "";
  const boxClass = [
    "ft-box",
    node.isPlaceholder ? "ft-box-placeholder" : "",
    node.isApplicant ? "" : "ft-box-non-applicant"
  ].filter(Boolean).join(" ");

  return `
    <g class="ft-person" data-node-id="${escapeXml(node.id)}" tabindex="0" role="button" aria-label="Select ${escapeXml(node.name)}">
      <rect class="${boxClass}" width="${BOX_W}" height="${BOX_H}" rx="10" ry="10"></rect>
      ${icon}
      ${lines.join("\n      ")}
    </g>`;
}

// Draws every connector: spouse lines, parent/child T + comb connectors, and
// dashed mapper links. Positions come from the final layout, never from
// guessed/floating coordinates.
export function renderConnectors(model, layout) {
  const parts = [];
  const allPositions = new Map();
  layout.components.forEach(c => c.positions.forEach((pos, id) => allPositions.set(id, pos)));
  const usedVerticals = [];

  const centerOf = pos => ({ x: pos.x + BOX_W / 2, y: pos.y + BOX_H / 2 });
  const rangesOverlap = (a1, a2, b1, b2, pad = 2) => {
    const minA = Math.min(a1, a2);
    const maxA = Math.max(a1, a2);
    const minB = Math.min(b1, b2);
    const maxB = Math.max(b1, b2);
    return !(maxA < (minB - pad) || maxB < (minA - pad));
  };
  const isVerticalLaneBusy = (x, y1, y2) =>
    usedVerticals.some(v => Math.abs(v.x - x) < 6 && rangesOverlap(v.y1, v.y2, y1, y2));
  const reserveVerticalLane = (x, y1, y2) => {
    usedVerticals.push({ x, y1: Math.min(y1, y2), y2: Math.max(y1, y2) });
  };
  const pickDropX = (preferredX, y1, y2) => {
    if (!isVerticalLaneBusy(preferredX, y1, y2)) return preferredX;
    const step = 10;
    for (let i = 1; i <= 10; i += 1) {
      const right = preferredX + i * step;
      if (!isVerticalLaneBusy(right, y1, y2)) return right;
      const left = preferredX - i * step;
      if (!isVerticalLaneBusy(left, y1, y2)) return left;
    }
    return preferredX;
  };

  // --- Spouse lines: a single horizontal line between adjacent partners ---
  model.spousePairs.forEach(pair => {
    const posA = allPositions.get(pair.a);
    const posB = allPositions.get(pair.b);
    if (!posA || !posB) return;
    const left = posA.x <= posB.x ? posA : posB;
    const right = posA.x <= posB.x ? posB : posA;
    // Only draw when actually adjacent (they belong to the same couple slot);
    // guards against drawing a line across the whole canvas for edge cases.
    if (right.x - (left.x + left.w) > BOX_W) return;
    const y = left.y + BOX_H / 2;
    parts.push(`<line class="ft-line ft-spouse-line" x1="${left.x + left.w}" y1="${y}" x2="${right.x}" y2="${y}"></line>`);
  });

  // --- Parent -> children T / comb connectors ---
  const groups = new Map();
  model.childParents.forEach((parents, childId) => {
    const key = `${parents.fatherId || ""}|${parents.motherId || ""}`;
    if (!groups.has(key)) groups.set(key, { fatherId: parents.fatherId, motherId: parents.motherId, childIds: [] });
    groups.get(key).childIds.push(childId);
  });

  const groupedEntries = Array.from(groups.values()).map(group => {
    const fatherPos = group.fatherId ? allPositions.get(group.fatherId) : null;
    const motherPos = group.motherId ? allPositions.get(group.motherId) : null;
    const childPositions = group.childIds.map(id => allPositions.get(id)).filter(Boolean);
    if (!childPositions.length || (!fatherPos && !motherPos)) return null;

    let parentCenterX, parentBottomY;
    if (fatherPos && motherPos) {
      parentCenterX = (fatherPos.x + fatherPos.w / 2 + motherPos.x + motherPos.w / 2) / 2;
      parentBottomY = Math.max(fatherPos.y + fatherPos.h, motherPos.y + motherPos.h);
    } else {
      const solo = fatherPos || motherPos;
      parentCenterX = solo.x + solo.w / 2;
      parentBottomY = solo.y + solo.h;
    }

    const childTopY = Math.min(...childPositions.map(c => c.y));
    return { group, fatherPos, motherPos, childPositions, parentCenterX, parentBottomY, childTopY };
  }).filter(Boolean);

  // Groups with similar parent baseline get small vertical lane offsets so
  // their sibling bars do not collapse onto the same Y pixel row.
  groupedEntries.sort((a, b) => (a.childTopY - b.childTopY) || (a.parentBottomY - b.parentBottomY) || (a.parentCenterX - b.parentCenterX));
  const lanesByBaseline = new Map();

  groupedEntries.forEach(entry => {
    const { group, childPositions, parentCenterX, parentBottomY, childTopY } = entry;
    const parentIdsAttr = [group.fatherId, group.motherId].filter(Boolean).map(escapeXml).join(",");
    const groupChildIdsAttr = group.childIds.filter(Boolean).map(escapeXml).join(",");
    const groupAttrs = `data-link-type="parent" data-parent-ids="${parentIdsAttr}" data-child-ids="${groupChildIdsAttr}"`;
    const baselineKey = String(Math.round(parentBottomY));
    const lane = lanesByBaseline.get(baselineKey) || 0;
    lanesByBaseline.set(baselineKey, (lane + 1) % 4);

    const minGapFromParent = 12;
    const maxGapToChildren = Math.max(minGapFromParent, childTopY - parentBottomY - minGapFromParent);
    const preferredGap = STEM + lane * 8;
    const barY = parentBottomY + Math.min(preferredGap, maxGapToChildren);

    if (childPositions.length === 1) {
      const child = childPositions[0];
      const childTopX = child.x + child.w / 2;
      const childIdAttr = (group.childIds[0] ? escapeXml(group.childIds[0]) : "");
      const childAttrs = `data-link-type="parent" data-parent-ids="${parentIdsAttr}" data-child-ids="${childIdAttr}"`;
      if (Math.abs(childTopX - parentCenterX) < 0.5) {
        parts.push(`<line class="ft-line ft-parent-line" ${childAttrs} x1="${parentCenterX}" y1="${parentBottomY}" x2="${parentCenterX}" y2="${childTopY}"></line>`);
        reserveVerticalLane(parentCenterX, parentBottomY, childTopY);
      } else {
        const dropX = pickDropX(childTopX, barY, childTopY);
        if (Math.abs(dropX - childTopX) < 0.5) {
          parts.push(`<path class="ft-line ft-parent-line" ${childAttrs} d="M ${parentCenterX} ${parentBottomY} L ${parentCenterX} ${barY} L ${dropX} ${barY} L ${dropX} ${childTopY}" fill="none"></path>`);
        } else {
          const joinY = Math.max(barY + 8, childTopY - 8);
          parts.push(`<path class="ft-line ft-parent-line" ${childAttrs} d="M ${parentCenterX} ${parentBottomY} L ${parentCenterX} ${barY} L ${dropX} ${barY} L ${dropX} ${joinY} L ${childTopX} ${joinY} L ${childTopX} ${childTopY}" fill="none"></path>`);
          reserveVerticalLane(childTopX, joinY, childTopY);
        }
        reserveVerticalLane(dropX, barY, childTopY);
      }
      return;
    }

    // Multiple children: stem down, sibling bar, then one drop per child.
    const childXs = childPositions.map(c => c.x + c.w / 2);
    const minX = Math.min(...childXs);
    const maxX = Math.max(...childXs);

    parts.push(`<line class="ft-line ft-parent-line" ${groupAttrs} x1="${parentCenterX}" y1="${parentBottomY}" x2="${parentCenterX}" y2="${barY}"></line>`);
    parts.push(`<line class="ft-line ft-parent-line" ${groupAttrs} x1="${minX}" y1="${barY}" x2="${maxX}" y2="${barY}"></line>`);
    childPositions.forEach(child => {
      const cx = child.x + child.w / 2;
      const childId = group.childIds.find(id => {
        const pos = allPositions.get(id);
        return !!pos && Math.abs((pos.x + pos.w / 2) - cx) < 0.5 && Math.abs(pos.y - child.y) < 0.5;
      });
      const childIdAttr = childId ? escapeXml(childId) : groupChildIdsAttr;
      const dropAttrs = `data-link-type="parent" data-parent-ids="${parentIdsAttr}" data-child-ids="${childIdAttr}"`;
      parts.push(`<line class="ft-line ft-parent-line" ${dropAttrs} x1="${cx}" y1="${barY}" x2="${cx}" y2="${child.y}"></line>`);
      reserveVerticalLane(cx, barY, child.y);
    });
    reserveVerticalLane(parentCenterX, parentBottomY, barY);
  });

  // --- Mapper: dashed line, labeled only with the mapper relationship ---
  model.mapperLinks.forEach(link => {
    const fromPos = allPositions.get(link.from);
    const toPos = allPositions.get(link.to);
    if (!fromPos || !toPos) return;
    const from = { x: fromPos.x + fromPos.w / 2, y: fromPos.y };
    const to = { x: toPos.x + toPos.w / 2, y: toPos.y + toPos.h };
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const k = Math.min(70, Math.max(26, Math.max(Math.abs(dx), Math.abs(dy)) * 0.35));
    const c1 = Math.abs(dx) >= Math.abs(dy)
      ? { x: from.x + (dx >= 0 ? k : -k), y: from.y }
      : { x: from.x, y: from.y + (dy >= 0 ? k : -k) };
    const c2 = Math.abs(dx) >= Math.abs(dy)
      ? { x: to.x - (dx >= 0 ? k : -k), y: to.y }
      : { x: to.x, y: to.y - (dy >= 0 ? k : -k) };
    const path = `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
    parts.push(`<path class="ft-line ft-mapper-line" data-link-type="mapper" data-from-id="${escapeXml(link.from)}" data-to-id="${escapeXml(link.to)}" d="${path}" fill="none"></path>`);
    if (link.label) {
      const labelWidth = Math.max(30, link.label.length * 6.6 + 12);
      parts.push(`
        <g class="ft-mapper-label" data-link-type="mapper-label" data-from-id="${escapeXml(link.from)}" data-to-id="${escapeXml(link.to)}">
          <rect x="${midX - labelWidth / 2}" y="${midY - 10}" width="${labelWidth}" height="18" rx="4"></rect>
          <text x="${midX}" y="${midY + 3}" text-anchor="middle">${escapeXml(link.label)}</text>
        </g>`);
    }
  });

  return parts.join("\n");
}

// Builds the full <svg> markup for the model + layout.
export function renderSvg(model, layout) {
  const allPositions = new Map();
  layout.components.forEach(c => c.positions.forEach((pos, id) => allPositions.set(id, pos)));

  const personNodes = Array.from(allPositions.entries()).map(([id, pos]) => {
    const node = model.nodes.get(id);
    if (!node) return "";
    return `<g transform="translate(${pos.x}, ${pos.y})">${renderPersonNode(node)}</g>`;
  }).join("\n");

  const titles = layout.components.map(c =>
    `<text class="ft-title" x="${c.titleX}" y="${c.titleY}" text-anchor="middle">${escapeXml(c.title)}</text>`
  ).join("\n");

  const connectors = renderConnectors(model, layout);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(layout.width)} ${Math.ceil(layout.height)}" width="${Math.ceil(layout.width)}" height="${Math.ceil(layout.height)}" class="family-tree-svg">
  <g class="ft-connectors">${connectors}</g>
  <g class="ft-titles">${titles}</g>
  <g class="ft-people">${personNodes}</g>
</svg>`;
}

/* ============================================================================
 * 8. FamilyScript-STYLE TEXT EXPORT
 * ========================================================================== */

// Produces a FamilyScript-style plain-text export of the internal model.
//   i<id>  p<name>  J(<epic>)  f<fatherId>  m<motherId>  s<spouseId>  g<f|m>
//   1<State, District>  2<AC, Part, Serial>
// Couples that are not expressed as a child's f/m pair (e.g. an applicant's
// spouse) are additionally emitted as "p<idA> <idB>\te2" pair lines.
export function buildFamilyScript(model) {
  const lines = [];
  lines.push("f1\tlState, District");
  lines.push("f2\tlAC, Part, Serial");
  lines.push("");

  const spouseOfAny = new Map();
  model.spousePairs.forEach(pair => {
    spouseOfAny.set(pair.a, pair.b);
    spouseOfAny.set(pair.b, pair.a);
  });

  model.nodes.forEach(node => {
    const tokens = [`i${node.id}`, `p${node.name}`];
    if (node.epic) tokens.push(`J(${node.epic})`);

    const parents = model.childParents.get(node.id);
    if (parents?.fatherId) tokens.push(`f${parents.fatherId}`);
    if (parents?.motherId) tokens.push(`m${parents.motherId}`);

    const spouseId = spouseOfAny.get(node.id);
    if (spouseId) tokens.push(`s${spouseId}`);

    if (node.gender === "male") tokens.push("gm");
    if (node.gender === "female") tokens.push("gf");

    if (node.stateDistrict) tokens.push(`1${node.stateDistrict}`);
    if (node.acPartSerial) tokens.push(`2${node.acPartSerial}`);

    lines.push(tokens.join("\t"));
  });

  // Spouse pairs that are not already implied by a child's f/m tokens above
  // (e.g. an applicant + spouse with no recorded shared child) still need to
  // be recorded, using the pair-line format shown in the FamilyScript spec.
  const impliedPairs = new Set();
  model.childParents.forEach(parents => {
    if (parents.fatherId && parents.motherId) {
      impliedPairs.add(`${parents.fatherId}|${parents.motherId}`);
      impliedPairs.add(`${parents.motherId}|${parents.fatherId}`);
    }
  });
  model.spousePairs.forEach(pair => {
    if (impliedPairs.has(`${pair.a}|${pair.b}`)) return;
    lines.push(`p${pair.a} ${pair.b}\te2`);
  });

  return lines.join("\n");
}

/* ============================================================================
 * 9. MODULE STATE + PUBLIC ENTRY POINTS
 * ========================================================================== */

const FT = {
  container: null,
  appState: null,
  model: null,
  layout: null,
  zoom: 1,
  selectedNodeId: null,
  wheelZoomBound: false
};

function splitIds(attrValue) {
  return String(attrValue || "").split(",").map(s => s.trim()).filter(Boolean);
}

function applySelectionHighlights() {
  const svg = FT.container?.querySelector("svg.family-tree-svg");
  if (!svg || !FT.model) return;

  const selectedId = FT.selectedNodeId;
  const personEls = Array.from(svg.querySelectorAll(".ft-person"));
  const parentLineEls = Array.from(svg.querySelectorAll('[data-link-type="parent"]'));
  const mapperLineEls = Array.from(svg.querySelectorAll('[data-link-type="mapper"]'));
  const mapperLabelEls = Array.from(svg.querySelectorAll('[data-link-type="mapper-label"]'));

  personEls.forEach(el => {
    el.classList.remove("is-selected", "is-parent", "is-mapper");
  });
  parentLineEls.forEach(el => el.classList.remove("is-highlight-parent"));
  mapperLineEls.forEach(el => el.classList.remove("is-highlight-mapper"));
  mapperLabelEls.forEach(el => el.classList.remove("is-highlight-mapper-label"));

  if (!selectedId) return;

  const selectedParents = FT.model.childParents.get(selectedId);
  const parentIds = new Set([selectedParents?.fatherId, selectedParents?.motherId].filter(Boolean));

  const mapperIds = new Set();
  FT.model.mapperLinks.forEach(link => {
    if (link.from === selectedId) mapperIds.add(link.to);
    if (link.to === selectedId) mapperIds.add(link.from);
  });

  personEls.forEach(el => {
    const id = el.getAttribute("data-node-id") || "";
    if (id === selectedId) el.classList.add("is-selected");
    if (parentIds.has(id)) el.classList.add("is-parent");
    if (mapperIds.has(id)) el.classList.add("is-mapper");
  });

  parentLineEls.forEach(el => {
    const childIds = splitIds(el.getAttribute("data-child-ids"));
    if (childIds.includes(selectedId)) el.classList.add("is-highlight-parent");
  });

  mapperLineEls.forEach(el => {
    const fromId = el.getAttribute("data-from-id") || "";
    const toId = el.getAttribute("data-to-id") || "";
    if (fromId === selectedId || toId === selectedId) el.classList.add("is-highlight-mapper");
  });

  mapperLabelEls.forEach(el => {
    const fromId = el.getAttribute("data-from-id") || "";
    const toId = el.getAttribute("data-to-id") || "";
    if (fromId === selectedId || toId === selectedId) el.classList.add("is-highlight-mapper-label");
  });
}

function wireSelectionInteractions() {
  const svg = FT.container?.querySelector("svg.family-tree-svg");
  if (!svg) return;

  const personEls = Array.from(svg.querySelectorAll(".ft-person"));
  personEls.forEach(el => {
    const pick = () => {
      const id = el.getAttribute("data-node-id") || null;
      FT.selectedNodeId = (FT.selectedNodeId === id) ? null : id;
      applySelectionHighlights();
    };
    el.addEventListener("click", ev => {
      ev.stopPropagation();
      pick();
    });
    el.addEventListener("keydown", ev => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        ev.stopPropagation();
        pick();
      }
    });
  });

  svg.addEventListener("click", () => {
    FT.selectedNodeId = null;
    applySelectionHighlights();
  });
}

// Rebuilds the model + layout from the current appState and re-renders it
// into the current container. Safe to call with no arguments once
// initFamilyTree() has run once.
export function renderFamilyTree() {
  if (!FT.container) return;
  const state = FT.appState || loadState();
  const model = buildFamilyTreeModel(state);
  const components = buildComponents(model);
  const layout = layoutFamilyForest(components, model);
  applyManualNodeNudges(layout, model);
  compactParentRows(layout, model);
  enforceOutwardSpousePlacement(layout, model);
  normalizeForestBounds(layout);

  FT.model = model;
  FT.layout = layout;

  if (FT.selectedNodeId && !model.nodes.has(FT.selectedNodeId)) {
    FT.selectedNodeId = null;
  }

  FT.container.innerHTML = layout.components.some(c => c.positions.size)
    ? renderSvg(model, layout)
    : `<p class="ft-empty">No people/applicant records found yet. Add records in the main app, then reopen the Family Tree.</p>`;

  wireSelectionInteractions();
  applySelectionHighlights();
  applyZoom(FT.zoom);
}

// Entry point called once from family-tree.html's bootstrap script.
export function initFamilyTree(container, appState) {
  FT.container = container;
  FT.appState = appState;
  renderFamilyTree();
}

/* ============================================================================
 * 10. ZOOM / FIT
 * ========================================================================== */

function applyZoom(zoom) {
  FT.zoom = Math.min(3, Math.max(0.3, zoom));
  const svg = FT.container?.querySelector("svg.family-tree-svg");
  if (svg) {
    svg.style.transform = `scale(${FT.zoom})`;
    svg.style.transformOrigin = "top left";
  }
}

export function zoomIn() { applyZoom(FT.zoom + 0.1); }
export function zoomOut() { applyZoom(FT.zoom - 0.1); }
export function zoomFit() { applyZoom(1); }

function bindWheelZoom() {
  if (FT.wheelZoomBound || !FT.container) return;
  const wrap = FT.container.closest(".ft-canvas-wrap");
  if (!wrap) return;

  wrap.addEventListener("wheel", event => {
    const svg = FT.container?.querySelector("svg.family-tree-svg");
    if (!svg) return;

    if (!event.ctrlKey) return;

    event.preventDefault();

    const oldZoom = FT.zoom;
    const step = event.deltaY < 0 ? 0.1 : -0.1;
    const nextZoom = Math.min(3, Math.max(0.3, oldZoom + step));
    if (Math.abs(nextZoom - oldZoom) < 0.0001) return;

    const rect = wrap.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;

    const logicalX = (wrap.scrollLeft + localX) / oldZoom;
    const logicalY = (wrap.scrollTop + localY) / oldZoom;

    applyZoom(nextZoom);

    wrap.scrollLeft = logicalX * nextZoom - localX;
    wrap.scrollTop = logicalY * nextZoom - localY;
  }, { passive: false });

  FT.wheelZoomBound = true;
}

/* ============================================================================
 * 11. EXPORT TOOLS (SVG / PNG / PDF / FamilyScript)
 * ========================================================================== */

function getSvgElement() {
  const svg = FT.container?.querySelector("svg.family-tree-svg");
  if (!svg) throw new Error("Nothing to export yet — the Family Tree has no records.");
  return svg;
}

function serializeSvg(svg) {
  const clone = svg.cloneNode(true);
  clone.style.transform = "";
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Inline the same visual rules used on screen so the exported file matches
  // what is shown, with no dependency on the page's external stylesheet.
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = FAMILY_TREE_SVG_CSS;
  clone.insertBefore(style, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportFamilyTreeSvg() {
  const svg = getSvgElement();
  const text = serializeSvg(svg);
  downloadBlob(new Blob([text], { type: "image/svg+xml" }), "family-tree.svg");
}

export function exportFamilyTreePng() {
  const svg = getSvgElement();
  const text = serializeSvg(svg);
  const width = Number(svg.getAttribute("width")) || svg.viewBox.baseVal.width;
  const height = Number(svg.getAttribute("height")) || svg.viewBox.baseVal.height;
  const scale = 2; // export at 2x for crisper PNGs

  const img = new Image();
  const svgBlob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => {
      if (blob) downloadBlob(blob, "family-tree.png");
    }, "image/png");
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

export function exportFamilyTreePdf() {
  // Matches the rest of this app's PDF approach (pdf.js): open a print-ready
  // window and let the browser's native "Save as PDF" do the work — no
  // third-party PDF library, no CDN.
  const svg = getSvgElement();
  const text = serializeSvg(svg);
  const win = window.open("", "_blank");
  if (!win) throw new Error("Popup blocked. Please allow popups to export the Family Tree as PDF.");

  const injectInlineSvgStyle = svgText => {
    const styleTag = `<style>${FAMILY_TREE_SVG_CSS}</style>`;
    return svgText.replace(/<svg\b[^>]*>/, match => `${match}${styleTag}`);
  };

  const buildComponentPageSvg = component => {
    const positionsArr = Array.from(component.positions.values());
    if (!positionsArr.length) return injectInlineSvgStyle(text);

    let minX = Infinity;
    let minY = Infinity;
    let maxRight = -Infinity;
    let maxBottom = -Infinity;

    positionsArr.forEach(pos => {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxRight = Math.max(maxRight, pos.x + pos.w);
      maxBottom = Math.max(maxBottom, pos.y + pos.h);
    });

    const localPositions = new Map();
    component.positions.forEach((pos, id) => {
      localPositions.set(id, {
        ...pos,
        x: pos.x - minX + CANVAS_PAD,
        y: pos.y - minY + TITLE_H
      });
    });

    const contentWidth = Math.max(BOX_W, maxRight - minX);
    const contentHeight = Math.max(BOX_H, maxBottom - minY);
    const pageLayout = {
      width: contentWidth + CANVAS_PAD * 2,
      height: TITLE_H + contentHeight + CANVAS_PAD,
      components: [{
        title: component.title,
        titleX: (contentWidth + CANVAS_PAD * 2) / 2,
        titleY: TITLE_H - 12,
        positions: localPositions,
        width: contentWidth,
        height: contentHeight
      }]
    };

    return injectInlineSvgStyle(renderSvg(FT.model, pageLayout));
  };

  const pagesHtml = FT.layout?.components?.length
    ? FT.layout.components.map(component => `<section class="pdf-page">${buildComponentPageSvg(component)}</section>`).join("\n")
    : `<section class="pdf-page">${injectInlineSvgStyle(text)}</section>`;

  win.document.write(`<!doctype html>
  <html><head><title>Family Tree</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    body { margin:0; font-family:Arial,Helvetica,sans-serif; }
    .print-toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      justify-content: flex-end;
      padding: 10px;
      background: #ffffff;
      border-bottom: 1px solid #dce8e2;
    }
    .print-toolbar button {
      border: 0;
      border-radius: 8px;
      background: #195b45;
      color: #fff;
      padding: 8px 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .print-area { padding: 8px; }
    .pdf-page { break-after: page; page-break-after: always; margin-bottom: 8px; }
    .pdf-page:last-child { break-after: auto; page-break-after: auto; }
    svg { width:100%; height:auto; }
    @media print {
      .print-toolbar { display:none; }
      .print-area { padding:0; }
      .pdf-page { margin:0; }
    }
  </style>
  </head><body>
    <div class="print-toolbar">
      <button type="button" onclick="window.print()">Print / Save PDF</button>
    </div>
    <div class="print-area">${pagesHtml}</div>
  </body></html>`);
  win.document.close();
  win.focus();
}

export function copyFamilyScript() {
  if (!FT.model) throw new Error("Nothing to copy yet — the Family Tree has no records.");
  const text = buildFamilyScript(FT.model);
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "readonly");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
  return Promise.resolve();
}

export function downloadFamilyScript() {
  if (!FT.model) throw new Error("Nothing to download yet — the Family Tree has no records.");
  const text = buildFamilyScript(FT.model);
  downloadBlob(new Blob([text], { type: "text/plain" }), "family-tree.familyscript.txt");
}

/* ============================================================================
 * 12. EXPORT-TIME INLINE STYLES
 * (kept separate from family-tree.css so exported SVG/PDF files render
 *  correctly even with no access to the page's stylesheet)
 * ========================================================================== */

const FAMILY_TREE_SVG_CSS = `
  .ft-box { fill:#f2faf6; stroke:#195b45; stroke-width:1.6; }
  .ft-box-non-applicant { fill:#eef1f3; stroke:#5f6b67; }
  .ft-box-placeholder { stroke-dasharray:4 3; }
  .ft-name { font:700 13.5px system-ui, sans-serif; fill:#17221d; }
  .ft-meta { font:400 12px system-ui, sans-serif; fill:#45524c; }
  .ft-title { font:700 16px system-ui, sans-serif; fill:#195b45; }
  .ft-line { stroke:#195b45; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; fill:none; }
  .ft-parent-line { stroke:#195b45; }
  .ft-spouse-line { stroke:#195b45; }
  .ft-mapper-line { stroke:#65736d; stroke-width:1.4; stroke-dasharray:6 4; }
  .ft-mapper-label rect { fill:#ffffff; stroke:#dce8e2; }
  .ft-mapper-label text { font:600 10.5px system-ui, sans-serif; fill:#45524c; }
`;

/* ============================================================================
 * 13. PAGE BOOTSTRAP
 * (runs only inside family-tree.html; harmless / inert if this module is
 *  ever imported in a context with no matching DOM, e.g. a future test)
 * ========================================================================== */

function bootstrapPage() {
  const root = document.getElementById("familyTreeCanvas");
  if (!root) return; // not on the Family Tree page — nothing to do

  const state = loadState();
  initFamilyTree(root, state);
  bindWheelZoom();

  document.getElementById("ftZoomOut")?.addEventListener("click", zoomOut);
  document.getElementById("ftZoomIn")?.addEventListener("click", zoomIn);
  document.getElementById("ftZoomFit")?.addEventListener("click", zoomFit);

  document.getElementById("ftExportSvg")?.addEventListener("click", () => safeRun(exportFamilyTreeSvg));
  document.getElementById("ftExportPng")?.addEventListener("click", () => safeRun(exportFamilyTreePng));
  document.getElementById("ftExportPdf")?.addEventListener("click", () => safeRun(exportFamilyTreePdf));
  document.getElementById("ftCopyScript")?.addEventListener("click", () => safeRun(async () => {
    await copyFamilyScript();
    toast("FamilyScript copied to clipboard.");
  }));
  document.getElementById("ftDownloadScript")?.addEventListener("click", () => safeRun(downloadFamilyScript));
}

function safeRun(fn) {
  try {
    const result = fn();
    if (result && typeof result.catch === "function") result.catch(showError);
  } catch (err) {
    showError(err);
  }
}

function showError(err) {
  console.error(err);
  toast(err?.message || "Something went wrong.");
}

function toast(message) {
  const el = document.getElementById("ftToast");
  if (!el) { alert(message); return; }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrapPage);
  } else {
    bootstrapPage();
  }
}
