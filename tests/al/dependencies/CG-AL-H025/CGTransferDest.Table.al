table 69041 "CG Transfer Dest"
{
    Caption = 'CG Transfer Dest';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20])
        {
            Caption = 'Code';
        }
        field(2; "Description"; Text[100])
        {
            Caption = 'Description';
        }
        field(3; "Amount"; Decimal)
        {
            Caption = 'Amount';
        }
        field(4; "Category"; Code[20])
        {
            Caption = 'Category';
        }
        field(5; "Enabled"; Boolean)
        {
            Caption = 'Enabled';
        }
    }

    keys
    {
        key(PK; "Code")
        {
            Clustered = true;
        }
    }
}
