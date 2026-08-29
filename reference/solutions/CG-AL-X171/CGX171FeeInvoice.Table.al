table 71551 "CG X171 Fee Invoice"
{
    Caption = 'CG X171 Fee Invoice';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
        }
        field(2; "Invoice Description"; Text[100])
        {
            Caption = 'Invoice Description';
        }
        field(3; "Handling Fee Pct"; Decimal)
        {
            Caption = 'Handling Fee Pct';
            DecimalPlaces = 0 : 5;
        }
        field(4; "Total Handling Fee"; Decimal)
        {
            Caption = 'Total Handling Fee';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
            Editable = false;
        }
        field(5; "Fees Calculated"; Boolean)
        {
            Caption = 'Fees Calculated';
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
