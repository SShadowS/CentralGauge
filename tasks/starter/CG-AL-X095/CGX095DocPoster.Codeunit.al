codeunit 70602 "CG X095 Doc Poster"
{
    procedure PostDocument(No: Code[20])
    var
        Document: Record "CG X095 Document";
        Archive: Record "CG X095 Doc Archive";
    begin
        Document.Get(No);

        Archive.Init();
        Archive."Document No." := Document."No.";
        Archive.Description := Document.Description;
        Archive.Amount := Document.Amount;
        Archive.Insert(true);

        Document.Posted := true;
        Document.Modify(true);
    end;

    procedure EditDescription(No: Code[20]; NewDescription: Text[100])
    var
        Document: Record "CG X095 Document";
    begin
        Document.Get(No);
        Document.Description := NewDescription;
        Document.Modify(true);
    end;
}
