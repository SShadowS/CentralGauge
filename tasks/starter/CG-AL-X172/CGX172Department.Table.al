table 71562 "CG X172 Department"
{
    Caption = 'CG X172 Department';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Order No."; Code[20])
        {
            Caption = 'Order No.';
        }
        field(2; "Warehouse Line No."; Integer)
        {
            Caption = 'Warehouse Line No.';
            TableRelation = "CG X172 Warehouse"."Line No." where("Order No." = field("Order No."));
        }
        field(3; "Department Line No."; Integer)
        {
            Caption = 'Department Line No.';
        }
        field(4; "Department Name"; Text[100])
        {
            Caption = 'Department Name';
        }
        field(10; Weight; Decimal)
        {
            Caption = 'Weight';
            DecimalPlaces = 0 : 5;
            MinValue = 0;
        }
        field(11; "Cost Share"; Decimal)
        {
            Caption = 'Cost Share';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
            Editable = false;
        }
    }

    keys
    {
        key(PK; "Order No.", "Warehouse Line No.", "Department Line No.")
        {
            Clustered = true;
        }
    }
}
