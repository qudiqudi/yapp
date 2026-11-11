# YAPP

Yet Another Pool Planner. A browser-based calculator for designing ZFS pools — capacity, fault tolerance, performance, and cost.

Live at https://qudiqudi.github.io/yapp/.

## What it does

- Compose a pool from layouts (RAID-Z1/2/3, mirror, stripe), drive count, capacity, and product.
- See usable capacity, parity tolerance, safety grade, rebuild time, sequential and random IOPS, and total cost — recomputed live as you change anything.
- Compare saved pool variants side-by-side with the best value per column highlighted.
- Pull current drive prices from regional retailers (diskprices, alternate, galaxus, office-partner, future-x, ARLT, serverpartdeals) and fall back to baked-in USD estimates offline.
- Browse the drive catalog with manufacturer datasheet values (MTBF, URE, IOPS, throughput), with derived numbers clearly marked.

## Running it locally

ES modules need a real HTTP origin — `file://` won't work.

```
python3 -m http.server 8765
```

Then open http://localhost:8765/index.html. Hard-refresh after edits; Python's http.server doesn't send cache-control headers.

## Stack

Native ES modules. No build step, no bundler, no framework, no dependencies. Just HTML, CSS, and JS files served statically. See CLAUDE.md for the file map and architecture notes.

## License

MIT.
