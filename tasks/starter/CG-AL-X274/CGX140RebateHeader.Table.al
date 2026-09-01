table 71000 "CG X140 Rebate Header"
{
    Caption = 'CG X140 Rebate Header';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
        }
        field(2; "Rebate Description"; Text[100])
        {
            Caption = 'Rebate Description';
        }
        field(3; "Total Rebate Amount"; Decimal)
        {
            Caption = 'Total Rebate Amount';
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
