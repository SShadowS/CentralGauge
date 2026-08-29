codeunit 71352 "CG X151 Block List"
{
    SingleInstance = true;

    var
        CachedVerdicts: Dictionary of [Code[20], Boolean];
        CacheLoaded: Boolean;

    procedure IsBlocked(EntryCode: Code[20]): Boolean
    begin
        LoadCacheIfNeeded();
        if CachedVerdicts.ContainsKey(EntryCode) then
            exit(CachedVerdicts.Get(EntryCode));
        exit(false);
    end;

    procedure SetBlocked(EntryCode: Code[20])
    var
        BlockEntry: Record "CG X151 Block Entry";
    begin
        if not BlockEntry.Get(EntryCode) then begin
            BlockEntry.Init();
            BlockEntry."Code" := EntryCode;
            BlockEntry.Insert();
        end;
        BlockEntry.Blocked := true;
        BlockEntry.Modify();
        Invalidate();
    end;

    procedure ClearBlocked(EntryCode: Code[20])
    var
        BlockEntry: Record "CG X151 Block Entry";
    begin
        if not BlockEntry.Get(EntryCode) then begin
            BlockEntry.Init();
            BlockEntry."Code" := EntryCode;
            BlockEntry.Insert();
        end;
        BlockEntry.Blocked := false;
        BlockEntry.Modify();
    end;

    procedure Invalidate()
    begin
        Clear(CachedVerdicts);
        CacheLoaded := false;
    end;

    local procedure LoadCacheIfNeeded()
    var
        BlockEntry: Record "CG X151 Block Entry";
    begin
        if CacheLoaded then
            exit;
        Clear(CachedVerdicts);
        if BlockEntry.FindSet() then
            repeat
                CachedVerdicts.Add(BlockEntry."Code", BlockEntry.Blocked);
            until BlockEntry.Next() = 0;
        CacheLoaded := true;
    end;
}
