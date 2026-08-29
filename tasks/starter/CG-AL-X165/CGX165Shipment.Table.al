table 71490 "CG X165 Shipment"
{
    DataClassification = CustomerContent;
    Caption = 'CG X165 Shipment';

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
            DataClassification = CustomerContent;
        }
        field(2; "Carrier Code"; Code[20])
        {
            Caption = 'Carrier Code';
            DataClassification = CustomerContent;
        }
        field(3; "Route Code"; Code[20])
        {
            Caption = 'Route Code';
            DataClassification = CustomerContent;
        }
        field(4; Priority; Integer)
        {
            Caption = 'Priority';
            DataClassification = CustomerContent;
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
