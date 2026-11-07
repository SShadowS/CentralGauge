codeunit 70042 "CGR Desk Selection Store"
{
    var
        NoSelectionErr: Label 'There is no saved selection %1.', Comment = '%1 = selection code';

    procedure SaveSelection(SelectionCode: Code[20]; var Selection: RecordRef)
    var
        Saved: Record "CGR Saved Desk Selection";
        SavedRecord: Record "CGR Saved Desk Record";
        LineNo: Integer;
    begin
        if Saved.Get(SelectionCode) then
            Saved.Delete();
        SavedRecord.SetRange("Selection Code", SelectionCode);
        SavedRecord.DeleteAll();

        Saved.Init();
        Saved."Selection Code" := SelectionCode;
        Saved."Table No." := Selection.Number();
        Saved."View Text" := CopyStr(Selection.GetView(), 1, MaxStrLen(Saved."View Text"));
        Saved."Key Index" := Selection.CurrentKeyIndex();
        Saved."Ascending Order" := Selection.Ascending();
        Saved.Insert();

        if Selection.FindSet() then
            repeat
                LineNo += 1;
                SavedRecord.Init();
                SavedRecord."Selection Code" := SelectionCode;
                SavedRecord."Line No." := LineNo;
                SavedRecord."Saved Record Id" := Selection.RecordId();
                SavedRecord.Insert();
            until Selection.Next() = 0;
    end;

    procedure OpenSelection(SelectionCode: Code[20]; var Selection: RecordRef)
    var
        Saved: Record "CGR Saved Desk Selection";
        SavedRecord: Record "CGR Saved Desk Record";
    begin
        if not Saved.Get(SelectionCode) then
            Error(NoSelectionErr, SelectionCode);

        Selection.Open(Saved."Table No.");
        Selection.SetView(Saved."View Text");
        Selection.CurrentKeyIndex(Saved."Key Index");
        Selection.Ascending(Saved."Ascending Order");

        SavedRecord.SetRange("Selection Code", SelectionCode);
        if SavedRecord.FindSet() then
            repeat
                if Selection.Get(SavedRecord."Saved Record Id") then
                    Selection.Mark(true);
            until SavedRecord.Next() = 0;
        Selection.MarkedOnly(true);
    end;
}
