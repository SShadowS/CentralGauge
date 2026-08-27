table 71110 "CG X022 Account"
{
    Caption = 'CG X022 Account';
    Access = Internal;
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
        }
        field(2; Balance; Integer)
        {
            Caption = 'Balance';
        }
        field(3; "Last Delta"; Integer)
        {
            Caption = 'Last Delta';
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }

    trigger OnModify()
    var
        PreviousAccount: Record "CG X022 Account";
    begin
        if PreviousAccount.Get(Rec."No.") then
            Rec."Last Delta" := Rec.Balance - PreviousAccount.Balance;
    end;
}