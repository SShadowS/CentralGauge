table 71561 "CG X172 Warehouse"
{
    Caption = 'CG X172 Warehouse';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Order No."; Code[20])
        {
            Caption = 'Order No.';
            TableRelation = "CG X172 Production Order"."No.";
        }
        field(2; "Line No."; Integer)
        {
            Caption = 'Line No.';
        }
        field(3; "Warehouse Name"; Text[100])
        {
            Caption = 'Warehouse Name';
        }
        field(10; Weight; Decimal)
        {
            Caption = 'Weight';
            DecimalPlaces = 0 : 5;
            MinValue = 0;
        }
        field(11; "Unit Cost"; Decimal)
        {
            Caption = 'Unit Cost';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
            MinValue = 0;
        }
        field(12; "Unit Share"; Integer)
        {
            Caption = 'Unit Share';
            Editable = false;
        }
        field(13; "Shipping Cost"; Decimal)
        {
            Caption = 'Shipping Cost';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
            Editable = false;
        }
    }

    keys
    {
        key(PK; "Order No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
