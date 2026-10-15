# Task 7888: One purge for sent outbox messages

Reported by the Integration team.

Last sprint we added two support procedures to `CGR Integration Facade` (Integration): `PurgeSentForVehicle(VehicleNo: Code[20]): Integer` and `PurgeSentBefore(CreatedBefore: DateTime): Integer`. Each purges the sent outbox entries in its own way and raises `OnBeforePurgeEntry` for every entry first, so archive apps can copy the entry or refuse the purge with an error. Support now needs more selections, and the purge logic should live in one place.

Requirement:

- Add the public procedure `PurgeSentEntries(var EntryFilter: Record "CGR Outbox Entry"; ChunkSize: Integer): Integer` to `CGR Integration Facade`. It purges every sent entry within the filters set on EntryFilter. Entries that are not sent stay, whether they have failed or not. It raises `OnBeforePurgeEntry` for each entry before the entry is purged. It returns the number of entries purged. The filters on EntryFilter are not changed.
- PurgeSentEntries works in chunks of ChunkSize entries. A ChunkSize below 1 means all entries in one chunk.
- Every completed chunk is final. When an archive app refuses an entry, the purge fails with the archive app's error; the entries of the chunks completed before it stay purged, and what the archive app wrote for them stays; the entries of the chunk that failed all stay in the outbox.
- The last chunk is final as well: what PurgeSentEntries purged stays purged when the caller's transaction fails afterwards.
- `PurgeSentForVehicle` and `PurgeSentBefore` purge through PurgeSentEntries, in chunks of 50 entries. What they purge and return stays as today.
- `PurgeSent` stays as it is today.
