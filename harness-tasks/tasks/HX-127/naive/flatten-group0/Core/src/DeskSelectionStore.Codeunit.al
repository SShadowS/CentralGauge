codeunit 70042 "CGR Desk Selection Store"
{
    var
        NoSelectionErr: Label 'There is no saved selection %1.', Comment = '%1 = selection code';

    procedure SaveSelection(SelectionCode: Code[20]; var Selection: RecordRef)
    var
        Saved: Record "CGR Saved Desk Selection";
        ScopeFilter: Record "CGR Saved Desk Scope Filter";
        FldRef: FieldRef;
        PrevGroup: Integer;
        Grp: Integer;
        i: Integer;
    begin
        if Saved.Get(SelectionCode) then
            Saved.Delete();
        ScopeFilter.SetRange("Selection Code", SelectionCode);
        ScopeFilter.DeleteAll();

        PrevGroup := Selection.FilterGroup();
        Selection.FilterGroup(0);
        Saved.Init();
        Saved."Selection Code" := SelectionCode;
        Saved."Table No." := Selection.Number();
        Saved."View Text" := CopyStr(Selection.GetView(), 1, MaxStrLen(Saved."View Text"));
        Saved."Key Index" := Selection.CurrentKeyIndex();
        Saved."Ascending Order" := Selection.Ascending();
        Saved.Insert();

        for Grp := 1 to 6 do begin
            Selection.FilterGroup(Grp);
            for i := 1 to Selection.FieldCount() do begin
                FldRef := Selection.FieldIndex(i);
                if FldRef.GetFilter() <> '' then begin
                    ScopeFilter.Init();
                    ScopeFilter."Selection Code" := SelectionCode;
                    ScopeFilter."Filter Group" := Grp;
                    ScopeFilter."Field No." := FldRef.Number();
                    ScopeFilter."Filter Text" := CopyStr(FldRef.GetFilter(), 1, MaxStrLen(ScopeFilter."Filter Text"));
                    ScopeFilter.Insert();
                end;
            end;
        end;
        Selection.FilterGroup(PrevGroup);
    end;

    procedure OpenSelection(SelectionCode: Code[20]; var Selection: RecordRef)
    var
        Saved: Record "CGR Saved Desk Selection";
        ScopeFilter: Record "CGR Saved Desk Scope Filter";
    begin
        if not Saved.Get(SelectionCode) then
            Error(NoSelectionErr, SelectionCode);

        Selection.Open(Saved."Table No.");
        Selection.FilterGroup(0);
        Selection.SetView(Saved."View Text");
        Selection.CurrentKeyIndex(Saved."Key Index");
        Selection.Ascending(Saved."Ascending Order");

        ScopeFilter.SetRange("Selection Code", SelectionCode);
        if ScopeFilter.FindSet() then
            repeat
                Selection.Field(ScopeFilter."Field No.").SetFilter(ScopeFilter."Filter Text");
            until ScopeFilter.Next() = 0;
        Selection.FilterGroup(0);
    end;
}
