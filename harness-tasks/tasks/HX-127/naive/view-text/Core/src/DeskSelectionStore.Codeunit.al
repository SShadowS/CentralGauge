codeunit 70042 "CGR Desk Selection Store"
{
    var
        NoSelectionErr: Label 'There is no saved selection %1.', Comment = '%1 = selection code';

    procedure SaveSelection(SelectionCode: Code[20]; var Selection: RecordRef)
    var
        Saved: Record "CGR Saved Desk Selection";
    begin
        if Saved.Get(SelectionCode) then
            Saved.Delete();
        Saved.Init();
        Saved."Selection Code" := SelectionCode;
        Saved."Table No." := Selection.Number();
        Saved."View Text" := CopyStr(Selection.GetView(), 1, MaxStrLen(Saved."View Text"));
        Saved.Insert();
    end;

    procedure OpenSelection(SelectionCode: Code[20]; var Selection: RecordRef)
    var
        Saved: Record "CGR Saved Desk Selection";
    begin
        if not Saved.Get(SelectionCode) then
            Error(NoSelectionErr, SelectionCode);
        Selection.Open(Saved."Table No.");
        Selection.SetView(Saved."View Text");
    end;
}
