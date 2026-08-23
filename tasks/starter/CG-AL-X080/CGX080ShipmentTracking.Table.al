table 70452 "CG X080 Shipment Tracking"
{
    Caption = 'CG X080 Shipment Tracking';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
            DataClassification = CustomerContent;
        }
        field(2; "Carrier Wire Code"; Integer)
        {
            Caption = 'Carrier Wire Code';
            DataClassification = CustomerContent;
        }
        field(3; Status; Enum "CG X080 Carrier Status")
        {
            Caption = 'Status';
            DataClassification = CustomerContent;
        }
        field(4; "Last Synced At"; DateTime)
        {
            Caption = 'Last Synced At';
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
