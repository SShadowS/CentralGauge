table 69030 "CG Bulk Test"
{
    Caption = 'CG Bulk Test';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
        }
        field(2; "Description"; Text[100])
        {
            Caption = 'Description';
        }
        field(3; "Amount"; Decimal)
        {
            Caption = 'Amount';
        }
        field(4; "Active"; Boolean)
        {
            Caption = 'Active';
            InitValue = true;
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}
