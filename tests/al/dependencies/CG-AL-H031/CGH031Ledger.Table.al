table 69310 "CG H031 Ledger"
{
    Caption = 'CG H031 Ledger';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
        }
        field(2; "Group Code"; Code[10])
        {
            Caption = 'Group Code';
        }
        field(10; "Amount"; Decimal)
        {
            Caption = 'Amount';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(Group; "Group Code")
        {
        }
    }
}
