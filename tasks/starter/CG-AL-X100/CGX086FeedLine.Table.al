table 70511 "CG X086 Feed Line"
{
    Caption = 'CG X086 Feed Line';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Line No."; Integer)
        {
            Caption = 'Line No.';
            DataClassification = CustomerContent;
        }
        field(2; "External Contact Id"; Code[20])
        {
            Caption = 'External Contact Id';
            DataClassification = CustomerContent;
        }
        field(3; "New External Contact Id"; Code[20])
        {
            Caption = 'New External Contact Id';
            DataClassification = CustomerContent;
        }
        field(4; "Company Name"; Text[100])
        {
            Caption = 'Company Name';
            DataClassification = CustomerContent;
        }
        field(5; "VAT Registration No."; Text[20])
        {
            Caption = 'VAT Registration No.';
            DataClassification = CustomerContent;
        }
        field(6; "Address"; Text[100])
        {
            Caption = 'Address';
            DataClassification = CustomerContent;
        }
        field(7; "Status"; Text[20])
        {
            Caption = 'Status';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Line No.")
        {
            Clustered = true;
        }
    }
}
