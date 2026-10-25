table 50140 "Sample Document Header"
{
    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Status; Option) { OptionMembers = Open,Archived; }
        field(3; "Archived By"; Code[50]) { }
    }
    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}

codeunit 50140 "Sample Document Mgt."
{
    // Takes only the key and mutates its own local copy of the record.
    procedure Archive(DocumentNo: Code[20])
    var
        DocumentHeader: Record "Sample Document Header";
    begin
        DocumentHeader.Get(DocumentNo);
        DocumentHeader.TestField(Status, DocumentHeader.Status::Open);
        DocumentHeader.Status := DocumentHeader.Status::Archived;
        DocumentHeader."Archived By" := CopyStr(UserId(), 1, MaxStrLen(DocumentHeader."Archived By"));
        DocumentHeader.Modify(true);
    end;
}

page 50140 "Sample Document Card"
{
    PageType = Card;
    SourceTable = "Sample Document Header";

    layout
    {
        area(Content)
        {
            group(General)
            {
                field("No."; Rec."No.") { }
                field(Status; Rec.Status) { }
                field("Archived By"; Rec."Archived By") { }
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(Archive)
            {
                trigger OnAction()
                var
                    DocumentMgt: Codeunit "Sample Document Mgt.";
                begin
                    DocumentMgt.Archive(Rec."No.");
                    // Rec still holds the pre-call values: "Archived By" is read from the stale buffer.
                    Message(ArchivedMsg, Rec."No.", Rec."Archived By");
                end;
            }
        }
    }

    var
        ArchivedMsg: Label 'Document %1 was archived by %2.', Comment = '%1 = document number, %2 = user who archived the document';
}
