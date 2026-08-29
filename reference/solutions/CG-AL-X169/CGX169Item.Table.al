table 71531 "CG X169 Item"
{
    DataClassification = CustomerContent;
    Caption = 'CG X169 Item';

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
            DataClassification = CustomerContent;
        }
        field(2; "Unit Cost"; Decimal)
        {
            Caption = 'Unit Cost';
            DataClassification = CustomerContent;
        }
        field(3; "Price Group"; Code[20])
        {
            Caption = 'Price Group';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}
