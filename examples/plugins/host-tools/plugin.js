window.toolbox.definePlugin({
  image: async (input) => {
    const files = await window.toolbox.files.select();
    const results = [];
    for (const file of files) {
      const result = await window.toolbox.image.compress(file.handle, {
        format: input.format,
        quality: input.quality,
        maxWidth: input.resize ? (input.maxWidth ?? 1920) : 0,
      });
      results.push(`${result.name}: ${result.saved ? '已保存' : '取消保存'} (${result.bytes} B)`);
    }
    return results;
  },
  compare: async (input) => {
    const results = [];
    for (const pair of input.pairs) {
      const result = await window.toolbox.diff.compare(pair.left, pair.right);
      results.push(JSON.stringify(result));
    }
    return results;
  },
});
