codeunit 70930 "CG X004 Copier"
{
    Access = Internal;

    procedure CopyAToB(): Integer
    var
        SourceItem: Record "CG X004 Item";
        TargetItem: Record "CG X004 Item";
        CreatedCount: Integer;
    begin
        CreatedCount := 0;
        SourceItem.SetRange(Category, 'A');
        if SourceItem.FindSet() then
            repeat
                if not TargetItem.Get(SourceItem.Tag + 1000) then begin
                    TargetItem.Init();
                    TargetItem."Entry No." := SourceItem.Tag + 1000;
                    TargetItem.Category := 'B';
                    TargetItem.Tag := SourceItem.Tag;
                    TargetItem.Insert();
                    CreatedCount += 1;
                end;
            until SourceItem.Next() = 0;
        exit(CreatedCount);
    end;
}