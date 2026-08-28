table 71001 "CG X140 Rebate Line"
{
    Caption = 'CG X140 Rebate Line';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Document No."; Code[20])
        {
            Caption = 'Document No.';
            TableRelation = "CG X140 Rebate Header"."No.";
        }
        field(2; "Line No."; Integer)
        {
            Caption = 'Line No.';
        }
        field(3; "Item Description"; Text[100])
        {
            Caption = 'Item Description';
        }
        field(10; "Allocation Weight"; Decimal)
        {
            Caption = 'Allocation Weight';
            DecimalPlaces = 0 : 5;
            MinValue = 0;
        }
        field(11; "Rebate Amount"; Decimal)
        {
            Caption = 'Rebate Amount';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
            Editable = false;
        }
    }

    keys
    {
        key(PK; "Document No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
