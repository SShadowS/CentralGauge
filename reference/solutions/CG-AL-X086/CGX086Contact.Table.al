table 70510 "CG X086 Contact"
{
    Caption = 'CG X086 Contact';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Contact Id"; Code[20])
        {
            Caption = 'Contact Id';
            DataClassification = CustomerContent;
        }
        field(2; "Company Name"; Text[100])
        {
            Caption = 'Company Name';
            DataClassification = CustomerContent;
        }
        field(3; "VAT Registration No."; Text[20])
        {
            Caption = 'VAT Registration No.';
            DataClassification = CustomerContent;
        }
        field(4; "Address"; Text[100])
        {
            Caption = 'Address';
            DataClassification = CustomerContent;
        }
        field(5; "Status"; Text[20])
        {
            Caption = 'Status';
            DataClassification = CustomerContent;
        }
        field(6; "Last Synced"; DateTime)
        {
            Caption = 'Last Synced';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Contact Id")
        {
            Clustered = true;
        }
    }
}
