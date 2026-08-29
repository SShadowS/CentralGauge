table 71494 "CG X165 Manifest Row"
{
    DataClassification = CustomerContent;
    Caption = 'CG X165 Manifest Row';

    fields
    {
        field(1; "Row No."; Integer)
        {
            Caption = 'Row No.';
            DataClassification = CustomerContent;
        }
        field(2; "Row Kind"; Option)
        {
            Caption = 'Row Kind';
            OptionMembers = Shipment,RouteTotal;
            DataClassification = CustomerContent;
        }
        field(3; "Shipment No."; Code[20])
        {
            Caption = 'Shipment No.';
            DataClassification = CustomerContent;
        }
        field(4; "Route Code"; Code[20])
        {
            Caption = 'Route Code';
            DataClassification = CustomerContent;
        }
        field(5; "Carrier Display"; Text[100])
        {
            Caption = 'Carrier Display';
            DataClassification = CustomerContent;
        }
        field(6; "Route Display"; Text[100])
        {
            Caption = 'Route Display';
            DataClassification = CustomerContent;
        }
        field(7; "Line Count"; Integer)
        {
            Caption = 'Line Count';
            DataClassification = CustomerContent;
        }
        field(8; "Total Weight"; Decimal)
        {
            Caption = 'Total Weight';
            DataClassification = CustomerContent;
        }
        field(9; "Freight Total"; Decimal)
        {
            Caption = 'Freight Total';
            DataClassification = CustomerContent;
        }
        field(10; Priority; Integer)
        {
            Caption = 'Priority';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Row No.")
        {
            Clustered = true;
        }
    }
}
