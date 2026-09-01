table 71542 "CG X170 Reversal Line"
{
    Caption = 'CG X170 Reversal Line';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Charge No."; Code[20])
        {
            Caption = 'Charge No.';
        }
        field(2; "Reversal No."; Code[20])
        {
            Caption = 'Reversal No.';
        }
        field(3; "Cost Center Line No."; Integer)
        {
            Caption = 'Cost Center Line No.';
            TableRelation = "CG X170 Cost Center"."Line No." where("Charge No." = field("Charge No."));
        }
        field(10; "Reversed Amount"; Decimal)
        {
            Caption = 'Reversed Amount';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
            Editable = false;
        }
    }

    keys
    {
        key(PK; "Charge No.", "Reversal No.", "Cost Center Line No.")
        {
            Clustered = true;
        }
    }
}
