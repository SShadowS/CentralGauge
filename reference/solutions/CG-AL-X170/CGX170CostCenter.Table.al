table 71541 "CG X170 Cost Center"
{
    Caption = 'CG X170 Cost Center';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Charge No."; Code[20])
        {
            Caption = 'Charge No.';
            TableRelation = "CG X170 Charge Header"."No.";
        }
        field(2; "Line No."; Integer)
        {
            Caption = 'Line No.';
        }
        field(3; "Cost Center Name"; Text[100])
        {
            Caption = 'Cost Center Name';
        }
        field(10; Weight; Decimal)
        {
            Caption = 'Weight';
            DecimalPlaces = 0 : 5;
            MinValue = 0;
        }
        field(11; "Allocated Amount"; Decimal)
        {
            Caption = 'Allocated Amount';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
            Editable = false;
        }
    }

    keys
    {
        key(PK; "Charge No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
