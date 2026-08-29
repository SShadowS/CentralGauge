table 71491 "CG X165 Shipment Line"
{
    DataClassification = CustomerContent;
    Caption = 'CG X165 Shipment Line';

    fields
    {
        field(1; "Shipment No."; Code[20])
        {
            Caption = 'Shipment No.';
            DataClassification = CustomerContent;
        }
        field(2; "Line No."; Integer)
        {
            Caption = 'Line No.';
            DataClassification = CustomerContent;
        }
        field(3; Weight; Decimal)
        {
            Caption = 'Weight';
            DataClassification = CustomerContent;
        }
        field(4; "Freight Amount"; Decimal)
        {
            Caption = 'Freight Amount';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Shipment No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
