table 71540 "CG X170 Charge Header"
{
    Caption = 'CG X170 Charge Header';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
        }
        field(2; "Charge Description"; Text[100])
        {
            Caption = 'Charge Description';
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
