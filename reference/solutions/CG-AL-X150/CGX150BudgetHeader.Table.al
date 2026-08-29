table 71341 "CG X150 Budget Header"
{
    Caption = 'CG X150 Budget Header';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
        }
        field(2; "Budget Description"; Text[100])
        {
            Caption = 'Budget Description';
        }
        field(3; "Total Amount"; Decimal)
        {
            Caption = 'Total Amount';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
        }
        field(4; Allocated; Boolean)
        {
            Caption = 'Allocated';
            Editable = false;
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
