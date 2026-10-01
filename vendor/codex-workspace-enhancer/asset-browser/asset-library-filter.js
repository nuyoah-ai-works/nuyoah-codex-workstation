function matchesQuery(asset, query) {
  if (!query) return true;
  return [asset.name, asset.preview, asset.category, ...(asset.tags || []), ...(asset.autoTags || [])]
    .join(" ")
    .toLocaleLowerCase("zh-CN")
    .includes(query);
}

export function filterLibraryResult(library, filters = {}) {
  const query = String(filters.query || "").trim().toLocaleLowerCase("zh-CN");
  const assets = (library.assets || []).filter((asset) => {
    if (filters.kind && asset.kind !== filters.kind) return false;
    if (filters.category && asset.category !== filters.category) return false;
    if (filters.smartGroup && asset.smartGroup !== filters.smartGroup) return false;
    return matchesQuery(asset, query);
  });
  const counts = { all: assets.length, text: 0, image: 0, audio: 0, video: 0 };
  const smartCounts = { asset: 0, review: 0, noise: 0 };
  for (const asset of assets) {
    counts[asset.kind] = (counts[asset.kind] || 0) + 1;
    smartCounts[asset.smartGroup] = (smartCounts[asset.smartGroup] || 0) + 1;
  }
  return { ...library, assets, counts, smartCounts };
}
