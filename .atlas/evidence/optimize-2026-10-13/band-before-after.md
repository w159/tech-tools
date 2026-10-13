# Band before/after (tick=3)

## Before
idle (120 cols)
    |⚑ idle · implement 1/3 · 0 open|
one worker implementing (160 cols)
    |⚒ implement 1/3 ▰▰▱▱▱ · ⠸ explorer-1 Edit 42s · ▸ /atlas-cc|
two workers (100 cols)
    |⚒ implement 1/3 ▰▰▱▱▱ · ⠸ explorer-1 Grep 42s · ⠸ explorer-2 Grep 42s · ▸ /atlas-cc|

## After
idle (120 cols)
    | ATLAS ⚑ idle · implement 1/3 · 0 open|
one worker implementing (160 cols)
    | ATLAS  ⚒ implement 1/3 ▰▰▱▱▱ · ⢿ explorer-1 Edit band.tsx 42s · ▸ /atlas-cc|
two workers (100 cols)
    | ATLAS  ⚒ implement 1/3 ▰▰▱▱▱ · ⢿ explorer-1 Grep 42s · ⢿ explorer-2 Grep 42s · ▸ /atlas-cc|

