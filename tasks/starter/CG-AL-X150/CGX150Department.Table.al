table 71342 "CG X150 Department"
{
    Caption = 'CG X150 Department';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Budget No."; Code[20])
        {
            Caption = 'Budget No.';
            TableRelation = "CG X150 Budget Header"."No.";
        }
        field(2; "Line No."; Integer)
        {
            Caption = 'Line No.';
        }
        field(3; "Department Name"; Text[100])
        {
            Caption = 'Department Name';
        }
        field(10; Weight; Decimal)
        {
            Caption = 'Weight';
            DecimalPlaces = 0 : 5;
            MinValue = 0;
        }
        field(11; "Department Amount"; Decimal)
        {
            Caption = 'Department Amount';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
            Editable = false;
        }
    }

    keys
    {
        key(PK; "Budget No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
