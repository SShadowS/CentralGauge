table 70480 "CG X083 Shipment Import Entry"
{
    DataClassification = CustomerContent;
    Caption = 'CG X083 Shipment Import Entry';

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
        }
        field(2; "Shipment No."; Code[20])
        {
            Caption = 'Shipment No.';
        }
        field(3; "Package Count"; Integer)
        {
            Caption = 'Package Count';
        }
        field(4; "Tracking No. Count"; Integer)
        {
            Caption = 'Tracking No. Count';
        }
        field(5; "Weight Unit"; Code[10])
        {
            Caption = 'Weight Unit';
        }
        field(6; Status; Option)
        {
            Caption = 'Status';
            OptionMembers = Received,"Empty Shipment";
            OptionCaption = 'Received,Empty Shipment';
        }
        field(7; "Imported At"; DateTime)
        {
            Caption = 'Imported At';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(ShipmentNo; "Shipment No.")
        {
        }
    }
}
