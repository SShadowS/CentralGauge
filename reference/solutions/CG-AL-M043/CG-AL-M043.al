table 70200 "CG M043 Document Group"
{
    Caption = 'CG M043 Document Group';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20])
        {
            Caption = 'Code';
            NotBlank = true;
        }
        field(2; Description; Text[100])
        {
            Caption = 'Description';
        }
    }

    keys
    {
        key(PK; "Code")
        {
            Clustered = true;
        }
    }

    trigger OnRename()
    var
        DocumentLine: Record "CG M043 Document Line";
    begin
        DocumentLine.SetRange("Group Code", xRec."Code");
        if DocumentLine.FindSet() then
            repeat
                DocumentLine.Rename("Code", DocumentLine."Line Code");
                DocumentLine.SetRange("Group Code", xRec."Code");
            until DocumentLine.FindSet() = false;
    end;
}